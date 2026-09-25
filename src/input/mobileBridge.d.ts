export {};

declare global {
  interface Window {
    mobileController?: {
      start(): Promise<{ port: number; token: string; addresses: string[] }>;
      stop(): Promise<boolean>;
      status(): Promise<{ active: boolean; port?: number; token?: string; addresses: string[] }>;
      onAxes(callback: (axes: { throttle: number; pitch: number; roll: number; yaw: number; brake: boolean }) => void): () => void;
      onLost(callback: () => void): () => void;
      onCommand(callback: (command: { command: 'flaps' | 'engine'; seq: number }) => void): () => void;
      onStatus(callback: (status: { type: string }) => void): () => void;
    };
  }
}
