import { Injectable, signal } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
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
      onAuthStateChanged(this.auth!, (user) => {
        this.user.set(user);
        this.loading.set(false);
        resolve(user);
      });
    });
  }

  async waitUntilReady(): Promise<User | null> {
    return this.ready;
  }

  isSignedIn(): boolean {
    return this.user() !== null;
  }

  async signInWithGoogle(): Promise<User> {
    if (!this.auth) {
      throw new Error('Firebase の設定が完了していません。');
    }

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
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
}
