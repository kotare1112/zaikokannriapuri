import { Injectable, signal } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth: Auth | null;
  private readonly ready: Promise<User | null>;

  readonly user = signal<User | null>(null);
  readonly loading = signal(true);
  readonly signInError = signal<string | null>(null);

  constructor() {
    if (!this.hasFirebaseConfiguration()) {
      this.auth = null;
      this.ready = Promise.resolve(null);
      this.loading.set(false);
      return;
    }

    const app = getApps().length ? getApp() : initializeApp(environment.firebase);
    this.auth = getAuth(app);
    this.ready = new Promise((resolve) => {
      let initialStateHandled = false;
      const finishInitialState = (user: User | null) => {
        this.user.set(user);
        this.loading.set(false);
        if (!initialStateHandled) {
          initialStateHandled = true;
          resolve(user);
        }
      };
      const initializationTimeout = window.setTimeout(() => finishInitialState(null), 8_000);

      onAuthStateChanged(this.auth!, (user) => {
        window.clearTimeout(initializationTimeout);
        finishInitialState(user);
      });
    });

    void getRedirectResult(this.auth).catch((error: unknown) => {
      this.signInError.set(this.errorMessage(error));
    });
  }

  async waitUntilReady(): Promise<User | null> {
    return this.ready;
  }

  isSignedIn(): boolean {
    return this.user() !== null;
  }

  watchUser(next: (user: User | null) => void): () => void {
    if (!this.auth) {
      next(null);
      return () => undefined;
    }

    return onAuthStateChanged(this.auth, next);
  }

  async signInWithGoogle(): Promise<User | null> {
    if (!this.auth) {
      throw new Error('Firebase の設定が完了していません。');
    }

    this.signInError.set(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    if (this.shouldUseRedirect()) {
      return signInWithRedirect(this.auth, provider);
    }

    const result = await signInWithPopup(this.auth, provider);
    this.user.set(result.user);
    return result.user;
  }

  async signOut(): Promise<void> {
    if (this.auth) {
      await firebaseSignOut(this.auth);
    }
  }

  private hasFirebaseConfiguration(): boolean {
    const { apiKey, appId, projectId } = environment.firebase;
    return Boolean(apiKey && appId && projectId);
  }

  private shouldUseRedirect(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Google ログインを完了できませんでした。もう一度お試しください。';
  }
}
