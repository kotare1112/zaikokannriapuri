import { Injectable } from '@angular/core';
import { User } from 'firebase/auth';
import {
  Firestore,
  Unsubscribe,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { environment } from '../../environments/environment';

const ACCESS_REQUESTS = 'accessRequests';

export type AccessStatus = 'developer' | 'approved' | 'pending' | 'rejected';

export interface AccessRequest {
  uid: string;
  email: string;
  displayName: string;
  status: Exclude<AccessStatus, 'developer'>;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

@Injectable({ providedIn: 'root' })
export class AccessControlService {
  private readonly db: Firestore | null;

  constructor() {
    const app = this.hasFirebaseConfiguration()
      ? getApps().length
        ? getApp()
        : initializeApp(environment.firebase)
      : null;
    this.db = app ? getFirestore(app) : null;
  }

  isDeveloper(user: User): boolean {
    return user.email?.toLowerCase() === environment.access.developerEmail.toLowerCase();
  }

  watchUserAccess(
    user: User,
    next: (status: AccessStatus) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    if (this.isDeveloper(user)) {
      next('developer');
      return () => undefined;
    }

    const db = this.requireDatabase();
    const reference = doc(db, ACCESS_REQUESTS, user.uid);
    let stopWatching: Unsubscribe | undefined;
    let cancelled = false;

    void this.createRequestIfMissing(reference, user)
      .then(() => {
        if (cancelled) return;
        stopWatching = onSnapshot(
          reference,
          (snapshot) => {
            const request = snapshot.data() as AccessRequest | undefined;
            next(request?.status ?? 'pending');
          },
          (error) => onError(error),
        );
      })
      .catch((error: unknown) => onError(this.toError(error)));

    return () => {
      cancelled = true;
      stopWatching?.();
    };
  }

  watchPendingRequests(
    next: (requests: AccessRequest[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    const db = this.requireDatabase();
    const requestsQuery = query(
      collection(db, ACCESS_REQUESTS),
      where('status', '==', 'pending'),
      orderBy('requestedAt', 'desc'),
    );

    return onSnapshot(
      requestsQuery,
      (snapshot) => next(snapshot.docs.map((item) => item.data() as AccessRequest)),
      (error) => onError(error),
    );
  }

  async reviewRequest(request: AccessRequest, status: 'approved' | 'rejected', user: User): Promise<void> {
    const db = this.requireDatabase();
    if (!this.isDeveloper(user)) {
      throw new Error('承認操作は管理者だけが実行できます。');
    }

    await updateDoc(doc(db, ACCESS_REQUESTS, request.uid), {
      status,
      reviewedAt: new Date().toISOString(),
      reviewedBy: user.email ?? '',
    });
  }

  private async createRequestIfMissing(reference: ReturnType<typeof doc>, user: User): Promise<void> {
    const snapshot = await getDoc(reference);
    if (snapshot.exists()) return;

    await setDoc(reference, {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      status: 'pending',
      requestedAt: new Date().toISOString(),
    } satisfies AccessRequest);
  }

  private hasFirebaseConfiguration(): boolean {
    const { apiKey, appId, projectId } = environment.firebase;
    return Boolean(apiKey && appId && projectId);
  }

  private requireDatabase(): Firestore {
    if (!this.db) throw new Error('Firebase の設定が完了していません。');
    return this.db;
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error('利用申請の処理に失敗しました。');
  }
}
