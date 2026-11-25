"use client";

import Image from 'next/image';
import { useEffect, useState } from 'react';

const placeholder = '/red-wyvern-ui-kit/img/user-placeholder.svg';

export function ProfileAvatar() {
  const [photo, setPhoto] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/profile', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const { uniStaffId } = await response.json();
        if (!controller.signal.aborted && typeof uniStaffId === 'string' && uniStaffId.trim() && uniStaffId.length <= 128) {
          setPhoto(`https://apis.eng.psu.ac.th/personnel/v1/photo/${encodeURIComponent(uniStaffId.trim())}.jpg`);
        }
      } catch { /* Keep the placeholder when the optional profile request fails. */ }
    }
    void load();
    return () => controller.abort();
  }, []);

  return <Image className="x-account-photo" src={photo && !failed ? photo : placeholder} alt="" width={34} height={34} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
