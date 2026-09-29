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

  readonly user = signal<User | null>(null);
  readonly loading = signal(true);
  readonly signInError = signal<string | null>(null);

  constructor() {
    if (!this.hasFirebaseConfiguration()) {
      this.auth = null;
      this.loading.set(false);
      return;
    }

    const app = getApps().length ? getApp() : initializeApp(environment.firebase);
    this.auth = getAuth(app);
    const initializationTimeout = window.setTimeout(() => {
      this.user.set(null);
      this.loading.set(false);
    }, 8_000);

    onAuthStateChanged(this.auth, (user) => {
      window.clearTimeout(initializationTimeout);
      this.user.set(user);
      this.loading.set(false);
    });

    void getRedirectResult(this.auth)
      .then((result) => {
        if (result?.user) this.user.set(result.user);
      })
      .catch((error: unknown) => {
        this.signInError.set(this.errorMessage(error));
      });
  }

  isSignedIn(): boolean {
    return this.user() !== null;
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
