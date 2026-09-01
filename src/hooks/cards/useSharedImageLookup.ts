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
  const [reportInfo, setReportInfo] = useState<ReportInfo | null>(null);

  // Render-time reset (React's documented "adjusting state when a prop
  // changes" pattern) instead of synchronous setState-in-effect: the moment
  // the fingerprint changes, the previous card's shared image and report
  // info disappear in the same render pass, before paint -- both effects
  // below are then only responsible for their own asynchronous fetch and
  // cleanup. One shared prevFingerprint tracker covers both, since both are
  // keyed on the exact same fingerprint value.
  const [prevFingerprint, setPrevFingerprint] = useState(fingerprint);
  if (fingerprint !== prevFingerprint) {
    setPrevFingerprint(fingerprint);
    setSharedImage(null);
    setReportInfo(null);
  }

  useEffect(() => {
    if (!fingerprint) return;

    let active = true;
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

  useEffect(() => {
    if (!fingerprint) return;

    // `active` guard added: the original effect had no stale-request
    // protection at all (unlike the sharedImage effect above), so a slow
    // response for a previous fingerprint could overwrite reportInfo after
    // a newer fingerprint's request had already resolved. Matches the same
    // cancellation pattern already used everywhere else in this file/hook
    // family.
    let active = true;
    fetch("/api/image-reports/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprints: [fingerprint] }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        const item = data?.[fingerprint];
        if (item) setReportInfo({ reports: item.reports ?? 0, status: item.status });
        else setReportInfo(null);
      })
      .catch(() => {
        if (active) setReportInfo(null);
      });
    return () => {
      active = false;
    };
  }, [fingerprint]);

  return { fingerprint, sharedImage, reportInfo };
}
