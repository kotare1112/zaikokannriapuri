import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
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
import { InventoryItem, ProductDetails } from './models/inventory-item';

type Notice = { kind: 'success' | 'error' | 'info'; text: string };
type Page = 'inventory' | 'admin';
type ScannerMode = 'register' | 'delete';
type RegistrationCandidate = { product: ProductDetails; needsName: boolean; fromMaster: boolean };

@Component({
  imports: [CommonModule, FormsModule, DatePipe, BarcodeScannerComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  private readonly access = inject(AccessControlService);
  private readonly auth = inject(AuthService);
  private readonly inventory = inject(InventoryRepository);
  private readonly yahooShopping = inject(YahooShoppingService);
  private stopWatching?: () => void;
  private stopAccessWatching?: () => void;
  private stopAccessRequests?: () => void;
  private accessCheckTimeout?: ReturnType<typeof setTimeout>;

  protected readonly user = this.auth.user;
  protected readonly authLoading = this.auth.loading;
  protected readonly signInError = this.auth.signInError;
  protected readonly accessStatus = signal<AccessStatus | 'loading' | 'error'>('loading');
  protected readonly activePage = signal<Page>('inventory');
  protected readonly pendingRequests = signal<AccessRequest[]>([]);
  protected readonly approvedRequests = signal<AccessRequest[]>([]);
  protected readonly isReviewing = signal<string | null>(null);
  protected readonly isRemoving = signal<string | null>(null);
  protected readonly items = signal<InventoryItem[]>([]);
  protected readonly notice = signal<Notice | null>(null);
  protected readonly scannerOpen = signal(false);
  protected readonly scannerMode = signal<ScannerMode | 'manual'>('register');
  protected readonly expandedAction = signal<ScannerMode | null>(null);
  protected readonly janEntryMode = signal<ScannerMode | null>(null);
  protected readonly pendingProduct = signal<RegistrationCandidate | null>(null);
  protected readonly registrationError = signal<string | null>(null);
  protected readonly isRegistering = signal(false);
  protected readonly isLoading = signal(true);
  protected readonly isSigningIn = signal(false);
  private readonly authStateEffect = effect(() => {
    const user = this.user();
    if (this.authLoading()) return;
    if (user) {
      this.beginAccessWatching(user);
      return;
    }
    this.resetSignedOutSession();
  });
  protected search = '';
  protected barcodeInput = '';
  protected manualBarcode = '';
  protected manualName = '';
  protected pendingName = '';
  protected pendingQuantity: number | null = 1;

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
  ngOnDestroy(): void {
    this.stopWatching?.();
    this.stopAccessWatching?.();
    this.stopAccessRequests?.();
    this.authStateEffect.destroy();
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
    this.stopAccessRequests?.();
    this.stopAccessRequests = undefined;
    this.resetSignedOutSession();
    await this.auth.signOut();
  }

  protected toggleActionMenu(mode: ScannerMode): void {
    if (!this.ensureInventoryAccess()) return;
    this.expandedAction.update((current) => (current === mode ? null : mode));
    this.janEntryMode.set(null);
  }

  protected openScanner(mode: ScannerMode | 'manual'): void {
    if (!this.ensureInventoryAccess()) return;
    this.scannerMode.set(mode);
    this.scannerOpen.set(true);
    this.expandedAction.set(null);
  }

  protected selectJanEntry(mode: ScannerMode): void {
    if (!this.ensureInventoryAccess()) return;
    this.janEntryMode.set(mode);
    this.expandedAction.set(null);
    this.barcodeInput = '';
  }

  protected closeScanner(): void {
    this.scannerOpen.set(false);
  }

  protected async barcodeDetected(barcode: string): Promise<void> {
    this.scannerOpen.set(false);
    if (this.scannerMode() === 'manual') {
      const janCode = this.cleanBarcode(barcode);
      if (!janCode) {
        this.showNotice('error', 'JANコードを読み取れませんでした。もう一度お試しください。');
        return;
      }
      this.manualBarcode = janCode;
      this.showNotice('info', 'JANコードを入力しました。商品名を入力して登録してください。');
      return;
    }
    if (this.scannerMode() === 'delete') {
      await this.deleteFromBarcode(barcode);
      return;
    }
    await this.prepareRegistration(barcode);
  }

  protected async submitBarcode(): Promise<void> {
    if (this.janEntryMode() === 'delete') {
      await this.deleteFromBarcode(this.barcodeInput);
      return;
    }
    await this.prepareRegistration(this.barcodeInput);
  }

  protected async registerManualProduct(): Promise<void> {
    const barcode = this.cleanBarcode(this.manualBarcode);
    if (!barcode) {
      this.showNotice('error', 'JANコードを入力してください。');
      return;
    }
    await this.prepareRegistration(barcode, this.manualName.trim());
  }

  protected closeRegistrationDialog(): void {
    if (this.isRegistering()) return;
    this.pendingProduct.set(null);
  }

  protected async confirmRegistration(): Promise<void> {
    const candidate = this.pendingProduct();
    if (!candidate || this.isRegistering() || !this.ensureInventoryAccess()) return;
    const name = candidate.needsName ? this.pendingName.trim() : candidate.product.name;
    if (!name) {
      this.registrationError.set('商品名を入力してください。');
      return;
    }
    const quantity = this.pendingQuantity;
    if (quantity === null || !Number.isSafeInteger(quantity) || quantity < 0) {
      this.registrationError.set('在庫数は0以上の整数で入力してください。');
      return;
    }
    this.registrationError.set(null);
    this.isRegistering.set(true);
    try {
      const isNew = await this.inventory.registerProduct({ ...candidate.product, name }, quantity);
      if (!isNew) {
        this.pendingProduct.set(null);
        this.showNotice('info', 'すでにその商品は登録されています。');
        return;
      }
      this.pendingProduct.set(null);
      this.barcodeInput = '';
      this.manualBarcode = '';
      this.manualName = '';
      this.showNotice('success', `JAN ${candidate.product.barcode} を在庫 ${quantity} で登録しました。`);
    } catch (error) {
      this.registrationError.set(this.errorMessage(error));
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
    this.watchAccessRequests();
  }

  protected openInventory(): void {
    this.activePage.set('inventory');
    this.stopAccessRequests?.();
    this.stopAccessRequests = undefined;
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

  private watchAccessRequests(): void {
    if (this.stopAccessRequests) return;
    this.stopAccessRequests = this.access.watchAccessRequests(
      (requests) => {
        const pending = requests
          .filter((request) => request.status === 'pending')
          .sort((first, second) => second.requestedAt.localeCompare(first.requestedAt));
        const approved = requests
          .filter((request) => request.status === 'approved')
          .sort((first, second) => first.displayName.localeCompare(second.displayName, 'ja'));
        this.pendingRequests.set(pending);
        this.approvedRequests.set(approved);
      },
      (error) => this.showNotice('error', this.errorMessage(error)),
    );
  }

  private resetSignedOutSession(): void {
    this.clearAccessCheckTimeout();
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.stopAccessWatching?.();
    this.stopAccessWatching = undefined;
    this.stopAccessRequests?.();
    this.stopAccessRequests = undefined;
    this.items.set([]);
    this.pendingRequests.set([]);
    this.approvedRequests.set([]);
    this.activePage.set('inventory');
    this.accessStatus.set('loading');
    this.scannerOpen.set(false);
    this.pendingProduct.set(null);
    this.expandedAction.set(null);
    this.janEntryMode.set(null);
    this.isLoading.set(false);
  }

  private clearAccessCheckTimeout(): void {
    if (this.accessCheckTimeout === undefined) return;
    clearTimeout(this.accessCheckTimeout);
    this.accessCheckTimeout = undefined;
  }

  private async prepareRegistration(rawBarcode: string, manualName?: string): Promise<void> {
    const barcode = this.cleanBarcode(rawBarcode);
    if (!barcode) {
      this.showNotice('error', 'JANコードを入力または読み取ってください。');
      return;
    }
    if (this.isRegistering() || !this.ensureInventoryAccess()) return;

    this.isRegistering.set(true);
    try {
      if (await this.inventory.getInventoryItem(barcode)) {
        this.showNotice('info', 'すでにその商品は登録されています。');
        return;
      }
      const master = await this.inventory.getMasterProduct(barcode);
      if (master) {
        this.openRegistrationDialog(master, false, true);
        return;
      }
      if (manualName !== undefined) {
        this.openRegistrationDialog(this.manualProduct(barcode, manualName), true, false);
        return;
      }
      this.showNotice('info', `JAN ${barcode} の商品情報を検索しています…`);
      let product: ProductDetails | null = null;
      let searchFailed = false;
      try {
        const products = await firstValueFrom(this.yahooShopping.searchByBarcode(barcode));
        if (products[0]) product = { ...products[0], source: 'yahoo-shopping' };
      } catch {
        searchFailed = true;
      }
      if (product) {
        this.openRegistrationDialog(product, false, false);
      } else {
        this.manualBarcode = barcode;
        this.openRegistrationDialog(this.manualProduct(barcode, ''), true, false);
        this.showNotice('info', searchFailed
          ? '商品情報を取得できませんでした。商品名を入力して登録できます。'
          : '商品情報が見つかりませんでした。商品名を入力して登録できます。');
      }
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isRegistering.set(false);
    }
  }

  private openRegistrationDialog(product: ProductDetails, needsName: boolean, fromMaster: boolean): void {
    this.pendingName = needsName ? product.name : '';
    this.pendingQuantity = 1;
    this.registrationError.set(null);
    this.notice.set(null);
    this.pendingProduct.set({ product, needsName, fromMaster });
  }

  private manualProduct(barcode: string, name: string): ProductDetails {
    return { barcode, name, imageUrl: '', productUrl: '', source: 'manual', brand: '', storeName: '' };
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
      this.barcodeInput = '';
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
