import { useEffect, useMemo, useState } from "react";
import { buildCardFingerprint } from "@/lib/fingerprint";
import { fetchSharedImage, type SharedImage } from "@/lib/db/sharedImages";

export type ReportInfo = { reports: number; status?: string };

/**
 * Community/shared-image lookup for the card creation form: computes a
 * fingerprint from the card's identifying fields, then looks up any
 * existing community reference image for that exact card plus its report
 * count/status (so a heavily-reported image can be hidden). Kept separate
 * from useCardImage since this is comps/reporting data keyed by fingerprint,
 * not image-upload/crop state itself.
 */
export function useSharedImageLookup({
  year,
  setName,
  cardNumber,
  playerName,
  team,
  insert,
  variation,
  parallel,
  serialTotal,
}: {
  year: string;
  setName: string;
  cardNumber: string;
  playerName: string;
  team: string;
  insert: string;
  variation: string;
  parallel: string;
  serialTotal: string;
}) {
  const fingerprint = useMemo(
    () =>
      buildCardFingerprint({
        year,
        setName,
        cardNumber,
        playerName,
        team,
        insert,
        variation,
        parallel,
        serialTotal,
      }),
    [year, setName, cardNumber, playerName, team, insert, variation, parallel, serialTotal]
  );

  const [sharedImage, setSharedImage] = useState<SharedImage | null>(null);

  useEffect(() => {
    let active = true;
    if (!fingerprint) {
      setSharedImage(null);
      return;
    }
    fetchSharedImage(fingerprint)
      .then((img) => {
        if (active) setSharedImage(img);
      })
      .catch(() => {
        if (active) setSharedImage(null);
      });
    return () => {
      active = false;
    };
  }, [fingerprint]);

  const [reportInfo, setReportInfo] = useState<ReportInfo | null>(null);

  useEffect(() => {
    if (!fingerprint) {
      setReportInfo(null);
      return;
    }
    fetch("/api/image-reports/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprints: [fingerprint] }),
    })
      .then((r) => r.json())
      .then((data) => {
        const item = data?.[fingerprint];
        if (item) setReportInfo({ reports: item.reports ?? 0, status: item.status });
        else setReportInfo(null);
      })
      .catch(() => setReportInfo(null));
  }, [fingerprint]);

  return { fingerprint, sharedImage, reportInfo };
}
