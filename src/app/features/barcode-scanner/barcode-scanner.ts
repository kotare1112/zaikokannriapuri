import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import type { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';

@Component({
  selector: 'app-barcode-scanner',
  templateUrl: './barcode-scanner.html',
  styleUrl: './barcode-scanner.scss',
})
export class BarcodeScannerComponent implements AfterViewInit, OnDestroy {
  @Output() readonly detected = new EventEmitter<string>();
  @Output() readonly close = new EventEmitter<void>();
  @ViewChild('preview') private readonly preview?: ElementRef<HTMLVideoElement>;

  protected readonly state = signal<'starting' | 'ready' | 'error'>('starting');
  protected readonly error = signal('');
  private reader?: BrowserMultiFormatReader;
  private controls?: IScannerControls;
  private hasDetected = false;
  private isDestroyed = false;

  async ngAfterViewInit(): Promise<void> {
    await this.start();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.stop();
  }

  protected closeScanner(): void {
    this.stop();
    this.close.emit();
  }

  private async start(): Promise<void> {
    const preview = this.preview?.nativeElement;
    if (!preview) return;

    // ZXing is only needed while the camera scanner is open. Loading it here
    // keeps the login and inventory screens light on mobile connections.
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    if (this.isDestroyed) return;

    this.reader = new BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 250,
      delayBetweenScanSuccess: 1200,
    });

    try {
      this.controls = await this.reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        preview,
        (result) => {
          if (!result || this.hasDetected) return;
          this.hasDetected = true;
          const value = result.getText().trim();
          this.stop();
          this.detected.emit(value);
        },
      );
      this.state.set('ready');
    } catch (error) {
      this.state.set('error');
      this.error.set(
        error instanceof Error
          ? `カメラを開始できませんでした: ${error.message}`
          : 'カメラを開始できませんでした。ブラウザのカメラ許可を確認してください。',
      );
    }
  }

  private stop(): void {
    this.controls?.stop();
    this.controls = undefined;
  }
}
