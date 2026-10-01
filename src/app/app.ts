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
type SortField = 'updatedAt' | 'name' | 'quantity' | 'barcode';
type SortDirection = 'asc' | 'desc';
type RegistrationCandidate = { product: ProductDetails; needsName: boolean; fromMaster: boolean };
type OptimisticInventoryChange = { item: InventoryItem | null; committed: boolean };

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
  private readonly japaneseCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
  private readonly readingCache = new Map<string, string>();
  private searchRequestId = 0;
  private stopWatching?: () => void;
  private stopAccessWatching?: () => void;
  private stopAccessRequests?: () => void;
  private accessCheckTimeout?: ReturnType<typeof setTimeout>;
  private inventoryRevision = 0;
  private isRefreshingInventory = false;
  private readonly refreshOnVisible = (): void => {
    if (document.visibilityState === 'visible') void this.refreshInventoryFromServer();
  };

  protected readonly user = this.auth.user;
  protected readonly authLoading = this.auth.loading;
  protected readonly signInError = this.auth.signInError;
  protected readonly accessStatus = signal<AccessStatus | 'loading' | 'error'>('loading');
  protected readonly activePage = signal<Page>('inventory');
  protected readonly pendingRequests = signal<AccessRequest[]>([]);
  protected readonly approvedRequests = signal<AccessRequest[]>([]);
  protected readonly isReviewing = signal<string | null>(null);
  protected readonly isRemoving = signal<string | null>(null);
  private readonly syncedItems = signal<InventoryItem[]>([]);
  private readonly optimisticChanges = signal<Map<string, OptimisticInventoryChange>>(new Map());
  protected readonly quantityDrafts = signal<Map<string, string>>(new Map());
  protected readonly savingQuantities = signal<Set<string>>(new Set());
  protected readonly items = computed(() => {
    const changes = this.optimisticChanges();
    const synced = this.syncedItems();
    if (!changes.size) return synced;
    const optimisticItems: InventoryItem[] = [];
    for (const change of changes.values()) {
      if (change.item) optimisticItems.push(change.item);
    }
    return [...optimisticItems, ...synced.filter((item) => !changes.has(item.barcode))];
  });
  protected readonly notice = signal<Notice | null>(null);
  protected readonly scannerOpen = signal(false);
  protected readonly scannerMode = signal<ScannerMode>('register');
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
  protected readonly search = signal('');
  protected readonly searchReading = signal('');
  protected readonly isReadingSearchLoading = signal(false);
  protected searchInput = '';
  protected readonly sortField = signal<SortField>('updatedAt');
  protected readonly sortDirection = signal<SortDirection>('desc');
  protected barcodeInput = '';
  protected pendingName = '';
  protected pendingQuantity: number | null = 1;

  protected readonly filteredItems = computed(() => {
    const keywords = [this.search(), this.searchReading()]
      .map((value) => this.normalizeSearchText(value))
      .filter(Boolean);
    const field = this.sortField();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const matching = keywords.length
      ? this.items().filter((item) => {
          const text = this.normalizeSearchText(
            [item.name, item.barcode, item.brand, item.storeName].join(' '),
          );
          return keywords.some((keyword) => text.includes(keyword));
        })
      : [...this.items()];
    return matching.sort((first, second) => {
      const comparison = field === 'quantity'
        ? first.quantity - second.quantity
        : field === 'name' || field === 'barcode'
          ? this.japaneseCollator.compare(first[field], second[field])
          : first.updatedAt.localeCompare(second.updatedAt);
      return comparison * direction || this.japaneseCollator.compare(first.barcode, second.barcode);
    });
  });
  protected readonly totalQuantity = computed(() =>
    this.items().reduce((total, item) => total + item.quantity, 0),
  );

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.refreshOnVisible);
    if (typeof window !== 'undefined') window.addEventListener('pageshow', this.refreshOnVisible);
  }

  protected async submitSearch(): Promise<void> {
    const query = this.searchInput.trim();
    const requestId = ++this.searchRequestId;
    this.search.set(query);
    this.searchReading.set('');
    this.isReadingSearchLoading.set(false);
    if (!/\p{Script=Han}/u.test(query)) return;
    const cachedReading = this.readingCache.get(query);
    if (cachedReading !== undefined) {
      this.searchReading.set(cachedReading);
      return;
    }

    this.isReadingSearchLoading.set(true);
    try {
      const reading = await firstValueFrom(this.yahooShopping.readingForSearch(query));
      this.readingCache.set(query, reading);
      if (requestId === this.searchRequestId) this.searchReading.set(reading);
    } catch {
      if (requestId === this.searchRequestId) {
        this.showNotice('info', '漢字の読みを取得できなかったため、通常の文字検索結果を表示しています。');
      }
    } finally {
      if (requestId === this.searchRequestId) this.isReadingSearchLoading.set(false);
    }
  }

  private normalizeSearchText(value: string): string {
    return value.normalize('NFKC').toLowerCase()
      .replace(/[\u30a1-\u30f6]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
      .replace(/\s+/gu, '');
  }

  protected setSortField(field: SortField): void {
    this.sortField.set(field);
    this.sortDirection.set(field === 'name' || field === 'barcode' ? 'asc' : 'desc');
  }

  protected toggleSortDirection(): void {
    this.sortDirection.update((direction) => direction === 'asc' ? 'desc' : 'asc');
  }
  ngOnDestroy(): void {
    this.stopWatching?.();
    this.stopAccessWatching?.();
    this.stopAccessRequests?.();
    this.authStateEffect.destroy();
    this.clearAccessCheckTimeout();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.refreshOnVisible);
    if (typeof window !== 'undefined') window.removeEventListener('pageshow', this.refreshOnVisible);
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

  protected openScanner(mode: ScannerMode): void {
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

  protected closeRegistrationDialog(): void {
    if (this.isRegistering()) return;
    this.pendingProduct.set(null);
  }

  protected adjustPendingQuantity(difference: number): void {
    const current = this.pendingQuantity;
    const quantity = current !== null && Number.isSafeInteger(current) && current >= 0 ? current : 0;
    this.pendingQuantity = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, quantity + difference));
    this.registrationError.set(null);
  }

  protected async confirmRegistration(): Promise<void> {
    const candidate = this.pendingProduct();
    if (!candidate || this.isRegistering() || !this.ensureInventoryAccess()) return;
    const name = this.pendingName.trim();
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
    const now = new Date().toISOString();
    const item: InventoryItem = {
      ...candidate.product,
      name,
      quantity,
      createdAt: now,
      updatedAt: now,
    };
    this.setOptimisticChange(item.barcode, { item, committed: false });
    this.pendingProduct.set(null);
    this.isRegistering.set(true);
    this.showNotice('info', '在庫一覧に反映しました。保存を確認しています…');
    try {
      const isNew = await this.inventory.registerProduct({ ...candidate.product, name }, quantity, now);
      if (!isNew) {
        this.setOptimisticChange(item.barcode, null);
        this.showNotice('info', 'すでにその商品は登録されています。');
        return;
      }
      this.commitOptimisticChange(item.barcode);
      this.barcodeInput = '';
      this.showNotice('success', `JAN ${candidate.product.barcode} を在庫 ${quantity} で登録しました。`);
    } catch (error) {
      this.setOptimisticChange(item.barcode, null);
      this.pendingProduct.set(candidate);
      this.notice.set(null);
      this.registrationError.set(this.errorMessage(error));
    } finally {
      this.isRegistering.set(false);
    }
  }

  protected async changeQuantity(item: InventoryItem, difference: number): Promise<void> {
    if (this.quantityDrafts().has(item.barcode) || this.savingQuantities().has(item.barcode) || !this.ensureInventoryAccess()) return;
    try {
      await this.inventory.changeQuantity(item.barcode, difference);
    } catch (error) {
      this.showNotice('error', this.errorMessage(error));
    }
  }

  protected editQuantity(barcode: string, value: string): void {
    this.quantityDrafts.update((current) => new Map(current).set(barcode, value));
  }

  protected cancelQuantityEdit(barcode: string): void {
    this.quantityDrafts.update((current) => {
      const next = new Map(current);
      next.delete(barcode);
      return next;
    });
  }

  protected async saveQuantity(item: InventoryItem): Promise<void> {
    const barcode = item.barcode;
    const draft = this.quantityDrafts().get(barcode);
    if (draft === undefined || this.isRegistering() || this.savingQuantities().has(barcode) || !this.ensureInventoryAccess()) return;
    const quantity = Number(draft);
    if (!draft.trim() || !Number.isSafeInteger(quantity) || quantity < 0) {
      this.showNotice('error', '在庫数は0以上の整数で入力してください。');
      return;
    }
    if (quantity === item.quantity) {
      this.cancelQuantityEdit(barcode);
      return;
    }
    this.savingQuantities.update((current) => new Set(current).add(barcode));
    const updatedAt = new Date().toISOString();
    this.setOptimisticChange(barcode, { item: { ...item, quantity, updatedAt }, committed: false });
    try {
      await this.inventory.setQuantity(barcode, quantity, updatedAt);
      this.commitOptimisticChange(barcode);
      this.cancelQuantityEdit(barcode);
      this.showNotice('success', `「${item.name}」の在庫数を ${quantity} に変更しました。`);
    } catch (error) {
      this.setOptimisticChange(barcode, null);
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.savingQuantities.update((current) => {
        const next = new Set(current);
        next.delete(barcode);
        return next;
      });
    }
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
    this.syncedItems.set([]);
    this.optimisticChanges.set(new Map());
    this.quantityDrafts.set(new Map());
    this.savingQuantities.set(new Set());
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
        this.syncedItems.set([]);
        this.optimisticChanges.set(new Map());
        this.quantityDrafts.set(new Map());
        this.savingQuantities.set(new Set());
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
      (items, fromServer) => {
        if (fromServer) this.inventoryRevision += 1;
        this.syncedItems.set(items);
        this.clearSyncedOptimisticChanges(items);
        this.isLoading.set(false);
      },
      (error) => {
        this.isLoading.set(false);
        this.showNotice('error', this.errorMessage(error));
      },
    );
  }

  private async refreshInventoryFromServer(): Promise<void> {
    const userId = this.user()?.uid;
    if (!userId || !this.stopWatching || this.isRefreshingInventory) return;
    this.isRefreshingInventory = true;
    const revision = this.inventoryRevision;
    try {
      const items = await this.inventory.refresh();
      if (this.user()?.uid !== userId || !this.stopWatching || this.inventoryRevision !== revision) return;
      this.inventoryRevision += 1;
      this.syncedItems.set(items);
      this.clearSyncedOptimisticChanges(items);
      this.isLoading.set(false);
    } catch {
      // 通信が一時的に使えない場合は、現在表示中の在庫を保持する。
    } finally {
      this.isRefreshingInventory = false;
    }
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
    this.syncedItems.set([]);
    this.optimisticChanges.set(new Map());
    this.quantityDrafts.set(new Map());
    this.savingQuantities.set(new Set());
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

  private async prepareRegistration(rawBarcode: string): Promise<void> {
    const barcode = this.cleanBarcode(rawBarcode);
    if (!barcode) {
      this.showNotice('error', 'JANコードを入力または読み取ってください。');
      return;
    }
    if (this.isRegistering() || !this.ensureInventoryAccess()) return;

    this.isRegistering.set(true);
    this.showNotice('info', `JAN ${barcode} の登録情報を確認しています…`);
    try {
      if (this.items().some((item) => item.barcode === barcode)) {
        this.showNotice('info', 'すでにその商品は登録されています。');
        return;
      }
      const [existingItem, master] = await Promise.all([
        this.inventory.getInventoryItem(barcode),
        this.inventory.getMasterProduct(barcode),
      ]);
      if (existingItem) {
        this.showNotice('info', 'すでにその商品は登録されています。');
        return;
      }
      if (master) {
        this.openRegistrationDialog(master, false, true);
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
    this.pendingName = product.name;
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
    if (this.isRegistering() || !this.ensureInventoryAccess()) return;

    this.setOptimisticChange(barcode, { item: null, committed: false });
    this.isRegistering.set(true);
    this.showNotice('info', `JAN ${barcode} を在庫一覧から削除しました。保存を確認しています…`);
    try {
      await this.inventory.deleteProduct(barcode);
      this.commitOptimisticChange(barcode);
      this.barcodeInput = '';
      this.showNotice('success', `JAN ${barcode} の商品を削除しました。`);
    } catch (error) {
      this.setOptimisticChange(barcode, null);
      this.showNotice('error', this.errorMessage(error));
    } finally {
      this.isRegistering.set(false);
    }
  }

  private setOptimisticChange(barcode: string, change: OptimisticInventoryChange | null): void {
    this.optimisticChanges.update((current) => {
      const next = new Map(current);
      if (change) next.set(barcode, change);
      else next.delete(barcode);
      return next;
    });
  }

  private commitOptimisticChange(barcode: string): void {
    const change = this.optimisticChanges().get(barcode);
    if (!change) return;
    const serverItem = this.syncedItems().find((item) => item.barcode === barcode);
    if (this.hasSyncedChange(change, serverItem)) {
      this.setOptimisticChange(barcode, null);
    } else {
      this.setOptimisticChange(barcode, { ...change, committed: true });
    }
  }

  private clearSyncedOptimisticChanges(items: InventoryItem[]): void {
    const current = this.optimisticChanges();
    if (!current.size) return;
    const next = new Map(current);
    for (const [barcode, change] of current) {
      if (change.committed && this.hasSyncedChange(change, items.find((item) => item.barcode === barcode))) {
        next.delete(barcode);
      }
    }
    if (next.size !== current.size) this.optimisticChanges.set(next);
  }

  private hasSyncedChange(change: OptimisticInventoryChange, serverItem: InventoryItem | undefined): boolean {
    return change.item
      ? serverItem?.updatedAt === change.item.updatedAt && serverItem.quantity === change.item.quantity
      : serverItem === undefined;
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
