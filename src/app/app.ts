import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CsvInventoryService } from './core/csv-inventory.service';
import { AuthService } from './core/auth.service';
import { InventoryRepository } from './core/inventory.repository';
import { YahooShoppingService } from './core/yahoo-shopping.service';
import { BarcodeScannerComponent } from './features/barcode-scanner/barcode-scanner';
import { InventoryItem } from './models/inventory-item';

type Notice = { kind: 'success' | 'error' | 'info'; text: string };

@Component({
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe, BarcodeScannerComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit, OnDestroy {
  private readonly inventory = inject(InventoryRepository);
  private readonly auth = inject(AuthService);
  private readonly yahooShopping = inject(YahooShoppingService);
  private readonly csv = inject(CsvInventoryService);
  private stopWatching?: () => void;

  protected readonly items = signal<InventoryItem[]>([]);
  protected readonly user = this.auth.user;
  protected readonly authLoading = this.auth.loading;
  protected readonly notice = signal<Notice | null>(null);
  protected readonly scannerOpen = signal(false);
  protected readonly isRegistering = signal(false);
  protected readonly isLoading = signal(true);
  protected readonly isSigningIn = signal(false);
  protected search = '';
  protected barcodeInput = '';
  protected manualBarcode = '';
  protected manualName = '';
  protected manualPrice: number | null = null;

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
  protected readonly totalValue = computed(() =>
    this.items().reduce((total, item) => total + (item.unitPrice ?? 0) * item.quantity, 0),
  );
  protected readonly lowStockCount = computed(
    () => this.items().filter((item) => item.quantity <= 3).length,
  );

  ngOnInit(): void {
    void this.initializeInventory();
  }

  private async initializeInventory(): Promise<void> {
    const user = await this.auth.waitUntilReady();
    if (!user) {
      this.isLoading.set(false);
      this.showNotice('info', '在庫を表示・操作するには Google でログインしてください。');
      return;
    }

    this.startWatchingInventory();
  }

  protected async signIn(): Promise<void> {
    this.isSigningIn.set(true);
    try {
      await this.auth.signInWithGoogle();
      this.startWatchingInventory();
      this.showNotice('success', 'Google アカウントでログインしました。');
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isSigningIn.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.items.set([]);
    this.scannerOpen.set(false);
    await this.auth.signOut();
    this.isLoading.set(false);
    this.showNotice('info', 'ログアウトしました。');
  }

  protected userLabel(): string {
    const user = this.user();
    return user?.displayName || user?.email || 'ログイン中';
  }

  private startWatchingInventory(): void {
    this.stopWatching?.();
    this.isLoading.set(true);
    this.stopWatching = this.inventory.watch(
      (items) => {
        this.items.set(items);
        this.isLoading.set(false);
      },
      (error) => {
        this.isLoading.set(false);
        this.showNotice('error', error.message);
      },
    );
  }

  ngOnDestroy(): void {
    this.stopWatching?.();
  }

  protected openScanner(): void {
    if (!this.ensureFirebase()) return;
    this.scannerOpen.set(true);
  }

  protected closeScanner(): void {
    this.scannerOpen.set(false);
  }

  protected async barcodeDetected(barcode: string): Promise<void> {
    this.scannerOpen.set(false);
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
    if (!this.ensureFirebase()) return;

    this.isRegistering.set(true);
    try {
      await this.inventory.registerManualProduct(
        barcode,
        this.manualName.trim(),
        this.manualPrice === null ? null : Number(this.manualPrice),
      );
      this.manualBarcode = '';
      this.manualName = '';
      this.manualPrice = null;
      this.showNotice('success', '手入力の商品を登録しました。');
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isRegistering.set(false);
    }
  }

  protected async changeQuantity(item: InventoryItem, difference: number): Promise<void> {
    if (!this.ensureFirebase()) return;
    try {
      await this.inventory.changeQuantity(item.barcode, difference);
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    }
  }

  protected exportCsv(): void {
    this.csv.download(this.items());
    this.showNotice('success', `${this.items().length} 件を CSV に書き出しました。`);
  }

  protected async importCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.ensureFirebase()) return;

    this.isRegistering.set(true);
    try {
      const rows = await this.csv.read(file);
      for (const row of rows) {
        await this.inventory.importRow(row);
      }
      this.showNotice('success', `${rows.length} 件の CSV データを反映しました。`);
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      input.value = '';
      this.isRegistering.set(false);
    }
  }

  protected stockClass(quantity: number): string {
    if (quantity === 0) return 'stock stock--empty';
    if (quantity <= 3) return 'stock stock--low';
    return 'stock';
  }

  private async registerFromBarcode(rawBarcode: string): Promise<void> {
    const barcode = this.cleanBarcode(rawBarcode);
    if (!barcode) {
      this.showNotice('error', '読み取ったバーコードが空です。');
      return;
    }
    if (!this.ensureFirebase()) return;

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
        'success',
        isNew
          ? `「${product.name}」を在庫 0 で登録しました。`
          : `「${product.name}」の商品情報を更新しました。`,
      );
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isRegistering.set(false);
    }
  }

  private ensureFirebase(): boolean {
    if (!this.auth.isSignedIn()) {
      this.showNotice('info', '先に Google でログインしてください。');
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
    return error instanceof Error ? error.message : '処理に失敗しました。もう一度お試しください。';
  }
}
