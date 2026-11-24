"use client";

import Image from 'next/image';
import { useEffect, useState } from 'react';

export function ProfileAvatar({ name }: { name: string }) {
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
      } catch { /* Keep initials when the optional profile request fails. */ }
    }
    void load();
    return () => controller.abort();
  }, []);

  return <span className="profile-avatar" aria-hidden="true">
    {name.slice(0, 1)}
    {photo && !failed && <Image src={photo} alt="" width={34} height={34} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </span>;
}
