export interface ScreenSource {
  id: string;
  name: string;
  thumbnailDataUrl: string | null;
}

export interface MfDesktopApi {
  getScreenSources: () => Promise<ScreenSource[]>;
  auth: {
    save: (session: unknown) => Promise<{ encrypted: boolean }>;
    load: () => Promise<unknown | null>;
    clear: () => Promise<void>;
  };
  setClockedIn: (value: boolean) => void;
}

declare global {
  interface Window {
    mfDesktop: MfDesktopApi;
  }
}
