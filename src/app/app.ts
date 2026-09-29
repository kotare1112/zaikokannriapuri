import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { User } from 'firebase/auth';
import { firstValueFrom } from 'rxjs';
import {
  AccessControlService,
  AccessRequest,
  AccessStatus,
} from './core/access-control.service';
import { AuthService } from './core/auth.service';
import { InventoryRepository } from './core/inventory.repository';
import { YahooShoppingService } from './core/yahoo-shopping.service';
import { BarcodeScannerComponent } from './features/barcode-scanner/barcode-scanner';
import { InventoryItem } from './models/inventory-item';

type Notice = { kind: 'success' | 'error' | 'info'; text: string };
type Page = 'inventory' | 'admin';
type ScannerMode = 'register' | 'delete';

@Component({
  imports: [CommonModule, FormsModule, DatePipe, BarcodeScannerComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit, OnDestroy {
  private readonly access = inject(AccessControlService);
  private readonly auth = inject(AuthService);
  private readonly inventory = inject(InventoryRepository);
  private readonly yahooShopping = inject(YahooShoppingService);
  private stopWatching?: () => void;
  private stopAccessWatching?: () => void;
  private stopPendingRequests?: () => void;
  private stopApprovedRequests?: () => void;
  private stopAuthWatching?: () => void;
  private accessCheckTimeout?: ReturnType<typeof setTimeout>;

  protected readonly user = this.auth.user;
  protected readonly authLoading = this.auth.loading;
  protected readonly accessStatus = signal<AccessStatus | 'loading' | 'error'>('loading');
  protected readonly activePage = signal<Page>('inventory');
  protected readonly pendingRequests = signal<AccessRequest[]>([]);
  protected readonly approvedRequests = signal<AccessRequest[]>([]);
  protected readonly isReviewing = signal<string | null>(null);
  protected readonly isRemoving = signal<string | null>(null);
  protected readonly items = signal<InventoryItem[]>([]);
  protected readonly notice = signal<Notice | null>(null);
  protected readonly scannerOpen = signal(false);
  protected readonly scannerMode = signal<ScannerMode>('register');
  protected readonly isRegistering = signal(false);
  protected readonly isLoading = signal(true);
  protected readonly isSigningIn = signal(false);
  protected search = '';
  protected barcodeInput = '';
  protected manualBarcode = '';
  protected manualName = '';

  protected readonly filteredItems = computed(() => {
    const keyword = this.search.trim().toLowerCase();
    if (!keyword) return this.items();
    return this.items().filter((item) =>
      [item.name, item.barcode, item.brand, item.storeName]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  });
  protected readonly totalQuantity = computed(() =>
    this.items().reduce((total, item) => total + item.quantity, 0),
  );
  ngOnInit(): void {
    this.stopAuthWatching = this.auth.watchUser((user) => {
      if (user) {
        this.beginAccessWatching(user);
        return;
      }
      this.resetSignedOutSession();
    });
  }

  ngOnDestroy(): void {
    this.stopWatching?.();
    this.stopAccessWatching?.();
    this.stopPendingRequests?.();
    this.stopApprovedRequests?.();
    this.stopAuthWatching?.();
    this.clearAccessCheckTimeout();
  }

  protected async signIn(): Promise<void> {
    this.isSigningIn.set(true);
    try {
      await this.auth.signInWithGoogle();
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isSigningIn.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.stopAccessWatching?.();
    this.stopAccessWatching = undefined;
    this.stopPendingRequests?.();
    this.stopPendingRequests = undefined;
    this.stopApprovedRequests?.();
    this.stopApprovedRequests = undefined;
    this.resetSignedOutSession();
    await this.auth.signOut();
  }

  protected openScanner(mode: ScannerMode): void {
    if (!this.ensureInventoryAccess()) return;
    this.scannerMode.set(mode);
    this.scannerOpen.set(true);
  }

  protected closeScanner(): void {
    this.scannerOpen.set(false);
  }

  protected async barcodeDetected(barcode: string): Promise<void> {
    this.scannerOpen.set(false);
    if (this.scannerMode() === 'delete') {
      await this.deleteFromBarcode(barcode);
      return;
    }
    await this.registerFromBarcode(barcode);
  }

  protected async submitBarcode(): Promise<void> {
    await this.registerFromBarcode(this.barcodeInput);
  }

  protected async registerManualProduct(): Promise<void> {
    const barcode = this.cleanBarcode(this.manualBarcode);
    if (!barcode || !this.manualName.trim()) {
      this.showNotice('error', 'バーコードと商品名を入力してください。');
      return;
    }
    if (!this.ensureInventoryAccess()) return;

    this.isRegistering.set(true);
    try {
      const isNew = await this.inventory.registerManualProduct(barcode, this.manualName.trim());
      if (!isNew) {
        this.showNotice('info', 'すでにその商品は登録されています。');
        return;
      }
      this.manualBarcode = '';
      this.manualName = '';
      this.showNotice('success', '手入力の商品を登録しました。');
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isRegistering.set(false);
    }
  }

  protected async changeQuantity(item: InventoryItem, difference: number): Promise<void> {
    if (!this.ensureInventoryAccess()) return;
    try {
      await this.inventory.changeQuantity(item.barcode, difference);
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    }
  }

  protected stockClass(quantity: number): string {
    if (quantity === 0) return 'stock stock--empty';
    if (quantity <= 3) return 'stock stock--low';
    return 'stock';
  }

  protected isDeveloper(): boolean {
    return this.accessStatus() === 'developer';
  }

  protected openAdmin(): void {
    if (!this.isDeveloper()) return;
    this.activePage.set('admin');
    this.watchPendingRequests();
    this.watchApprovedRequests();
  }

  protected openInventory(): void {
    this.activePage.set('inventory');
    this.stopPendingRequests?.();
    this.stopPendingRequests = undefined;
    this.stopApprovedRequests?.();
    this.stopApprovedRequests = undefined;
    this.pendingRequests.set([]);
    this.approvedRequests.set([]);
  }

  protected async reviewRequest(request: AccessRequest, status: 'approved' | 'rejected'): Promise<void> {
    const user = this.user();
    if (!user || !this.isDeveloper()) return;

    this.isReviewing.set(request.uid);
    try {
      await this.access.reviewRequest(request, status, user);
      this.showNotice('success', status === 'approved' ? '利用を承認しました。' : '申請を却下しました。');
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isReviewing.set(null);
    }
  }

  protected async removeAccess(request: AccessRequest): Promise<void> {
    const user = this.user();
    if (!user || !this.isDeveloper()) return;

    const accountName = request.displayName || request.email;
    if (!window.confirm(`「${accountName}」の在庫管理の利用を削除しますか？`)) return;

    this.isRemoving.set(request.uid);
    try {
      await this.access.removeAccess(request, user);
      this.showNotice('success', `「${accountName}」の利用を削除しました。`);
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isRemoving.set(null);
    }
  }

  protected retryAccessCheck(): void {
    const user = this.user();
    if (user) this.beginAccessWatching(user);
  }

  protected userLabel(): string {
    const user = this.user();
    return user?.displayName || user?.email || 'ログイン中';
  }

  private beginAccessWatching(user: User): void {
    this.stopAccessWatching?.();
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.items.set([]);
    this.clearAccessCheckTimeout();
    this.accessStatus.set('loading');
    this.accessCheckTimeout = setTimeout(() => {
      if (this.accessStatus() !== 'loading') return;
      this.accessStatus.set('error');
      this.isLoading.set(false);
      this.showNotice('error', '接続に時間がかかっています。通信状態を確認して、もう一度お試しください。');
    }, 15_000);
    this.stopAccessWatching = this.access.watchUserAccess(
      user,
      (status) => {
        this.clearAccessCheckTimeout();
        this.accessStatus.set(status);
        if (status === 'developer' || status === 'approved') {
          this.startWatchingInventory();
          return;
        }
        this.stopWatching?.();
        this.stopWatching = undefined;
        this.items.set([]);
        this.isLoading.set(false);
      },
      (error) => {
        this.clearAccessCheckTimeout();
        this.accessStatus.set('error');
        this.isLoading.set(false);
        this.showNotice('error', this.errorMessage(error));
      },
    );
  }

  private startWatchingInventory(): void {
    if (this.stopWatching) return;
    this.isLoading.set(true);
    this.stopWatching = this.inventory.watch(
      (items) => {
        this.items.set(items);
        this.isLoading.set(false);
      },
      (error) => {
        this.isLoading.set(false);
        this.showNotice('error', this.errorMessage(error));
      },
    );
  }

  private watchPendingRequests(): void {
    if (this.stopPendingRequests) return;
    this.stopPendingRequests = this.access.watchPendingRequests(
      (requests) => this.pendingRequests.set(requests),
      (error) => this.showNotice('error', this.errorMessage(error)),
    );
  }

  private watchApprovedRequests(): void {
    if (this.stopApprovedRequests) return;
    this.stopApprovedRequests = this.access.watchApprovedRequests(
      (requests) => this.approvedRequests.set(requests),
      (error) => this.showNotice('error', this.errorMessage(error)),
    );
  }

  private resetSignedOutSession(): void {
    this.clearAccessCheckTimeout();
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.stopAccessWatching?.();
    this.stopAccessWatching = undefined;
    this.stopPendingRequests?.();
    this.stopPendingRequests = undefined;
    this.stopApprovedRequests?.();
    this.stopApprovedRequests = undefined;
    this.items.set([]);
    this.pendingRequests.set([]);
    this.approvedRequests.set([]);
    this.activePage.set('inventory');
    this.accessStatus.set('loading');
    this.scannerOpen.set(false);
    this.isLoading.set(false);
  }

  private clearAccessCheckTimeout(): void {
    if (this.accessCheckTimeout === undefined) return;
    clearTimeout(this.accessCheckTimeout);
    this.accessCheckTimeout = undefined;
  }

  private async registerFromBarcode(rawBarcode: string): Promise<void> {
    const barcode = this.cleanBarcode(rawBarcode);
    if (!barcode) {
      this.showNotice('error', '読み取ったバーコードが空です。');
      return;
    }
    if (!this.ensureInventoryAccess()) return;

    this.isRegistering.set(true);
    this.showNotice('info', `JAN ${barcode} を Yahoo!ショッピングで検索しています…`);
    try {
      const products = await firstValueFrom(this.yahooShopping.searchByBarcode(barcode));
      const product = products[0];
      if (!product) {
        this.manualBarcode = barcode;
        throw new Error(
          'Yahoo!ショッピングで商品が見つかりませんでした。下の手入力フォームから登録できます。',
        );
      }

      const isNew = await this.inventory.registerCatalogProduct(product);
      this.barcodeInput = '';
      this.showNotice(
        isNew ? 'success' : 'info',
        isNew ? `「${product.name}」を在庫 0 で登録しました。` : 'すでにその商品は登録されています。',
      );
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isRegistering.set(false);
    }
  }

  private async deleteFromBarcode(rawBarcode: string): Promise<void> {
    const barcode = this.cleanBarcode(rawBarcode);
    if (!barcode) {
      this.showNotice('error', '読み取ったバーコードが空です。');
      return;
    }
    if (!this.ensureInventoryAccess()) return;

    this.isRegistering.set(true);
    try {
      await this.inventory.deleteProduct(barcode);
      this.showNotice('success', `JAN ${barcode} の商品を削除しました。`);
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isRegistering.set(false);
    }
  }

  private ensureInventoryAccess(): boolean {
    if (!this.auth.isSignedIn()) {
      this.showNotice('info', '先に Google でログインしてください。');
      return false;
    }
    if (this.accessStatus() !== 'developer' && this.accessStatus() !== 'approved') {
      this.showNotice('info', '管理者の承認後に在庫管理機能を利用できます。');
      return false;
    }
    if (this.inventory.isAvailable()) return true;
    this.showNotice('error', this.inventory.configurationMessage());
    return false;
  }

  private cleanBarcode(value: string): string {
    return value.trim().replace(/[\s-]/g, '');
  }

  private showNotice(kind: Notice['kind'], text: string): void {
    this.notice.set({ kind, text });
  }

  private errorMessage(error: unknown): string {
    const code = (error as { code?: string }).code;
    if (code === 'permission-denied') {
      return 'この操作を行う権限がありません。管理者の承認状況を確認してください。';
    }
    return error instanceof Error ? error.message : '処理に失敗しました。もう一度お試しください。';
  }
}
