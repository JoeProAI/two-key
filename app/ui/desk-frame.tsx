"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

const OfflineContext = createContext(false);

export function useOffline(): boolean {
  return useContext(OfflineContext);
}

export function DeskFrame({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return (
    <OfflineContext.Provider value={offline}>
      <a className="skip" href="#payee">Skip to the payee and amount</a>
      {offline ? (
        <p className="banner" id="offline-note" role="status">
          Offline. This is the last page that loaded. Controls stay off until the browser is back online. The receipt was not changed.
        </p>
      ) : null}
      {children}
    </OfflineContext.Provider>
  );
}
