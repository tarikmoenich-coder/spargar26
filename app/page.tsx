"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";

export default function Home() {
  const router = useRouter();
  const { loading, userId } = useProfile();

  useEffect(() => {
    if (loading) return;
    router.replace(userId ? "/erfassung" : "/login");
  }, [loading, userId, router]);

  return <p className="text-neutral-500">Lädt…</p>;
}
