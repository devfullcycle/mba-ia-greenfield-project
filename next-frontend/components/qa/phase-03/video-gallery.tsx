"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QA_API_BASE } from "@/lib/qa/phase-03/runner";
import { SEED } from "@/lib/qa/phase-03/steps";
import { PROFILE_LABEL, type Profile } from "@/lib/qa/phase-03/types";

import { VideoStatusBadge } from "./status-badge";

interface GalleryEntry {
  id: string;
  profile: Profile;
  origin: string;
}

interface VideoMeta {
  status?: string;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  codec?: string | null;
  error_reason?: string | null;
}

type Loaded = { http: number; meta?: VideoMeta } | { failure: string };

// The gallery asks as the QA session owner, except for the video that belongs to the other user.
const SEED_ENTRIES: GalleryEntry[] = [
  { id: SEED.ready, profile: "owner", origin: "seed (pronto)" },
  { id: SEED.processing, profile: "owner", origin: "seed (processando)" },
  { id: SEED.error, profile: "owner", origin: "seed (com erro)" },
  { id: SEED.otherProcessing, profile: "other", origin: "seed (de outro usuário)" },
];

const mediaUrl = (id: string, kind: "stream" | "download" | "thumbnail", profile: Profile) =>
  `${QA_API_BASE}/videos/${id}/${kind}?profile=${profile}`;

function PlaceholderReason({ loaded }: { loaded?: Loaded }) {
  let text = "Carregando…";
  if (loaded && "failure" in loaded) text = loaded.failure;
  else if (loaded?.http === 404)
    text = "Não visível para este perfil (404): vídeo inexistente, não pronto para o público ou de outro usuário.";
  else if (loaded?.meta?.status === "ERROR") text = `O processamento falhou (${loaded.meta.error_reason ?? "motivo desconhecido"}). Não há mídia.`;
  else if (loaded?.meta?.status === "PROCESSING") text = "Ainda processando: a mídia só existe quando o status for READY.";
  else if (loaded?.meta?.status === "DRAFT") text = "Rascunho: o upload ainda não foi finalizado.";
  else if (loaded) text = `Sem mídia disponível (HTTP ${loaded.http}).`;
  return (
    <div className="flex aspect-video items-center justify-center bg-muted p-4 text-center text-body-md text-muted-foreground">{text}</div>
  );
}

export function VideoGallery({ sessionVideoIds, refreshToken }: { sessionVideoIds: string[]; refreshToken: number }) {
  const [custom, setCustom] = useState<GalleryEntry[]>([]);
  const [customId, setCustomId] = useState("");
  const [customProfile, setCustomProfile] = useState<Profile>("owner");
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});

  const entries: GalleryEntry[] = [
    ...SEED_ENTRIES,
    ...sessionVideoIds.map((id) => ({ id, profile: "owner" as Profile, origin: "enviado nesta sessão" })),
    ...custom,
  ].filter((e, i, all) => all.findIndex((o) => o.id === e.id && o.profile === e.profile) === i);

  const key = (e: GalleryEntry) => `${e.profile}:${e.id}`;
  const entryKey = entries.map(key).join(",");

  const load = useCallback(async (list: GalleryEntry[]) => {
    const results = await Promise.all(
      list.map(async (e): Promise<[string, Loaded]> => {
        try {
          const res = await fetch(`${QA_API_BASE}/videos/${e.id}`, { headers: { "x-qa-profile": e.profile }, cache: "no-store" });
          const meta = res.ok ? ((await res.json()) as VideoMeta) : undefined;
          return [`${e.profile}:${e.id}`, { http: res.status, meta }];
        } catch {
          return [`${e.profile}:${e.id}`, { failure: "Falha de rede ao consultar o vídeo." }];
        }
      }),
    );
    setLoaded(Object.fromEntries(results));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(entries), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey, refreshToken, load]);

  function addCustom(ev: React.FormEvent) {
    ev.preventDefault();
    const id = customId.trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) return;
    setCustom((c) => [...c, { id, profile: customProfile, origin: "consulta manual" }]);
    setCustomId("");
  }

  return (
    <section aria-labelledby="gallery-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="gallery-title" className="text-h2">Vídeos</h2>
          <p className="text-body-md text-muted-foreground">
            Vídeos da seed e enviados nesta sessão. Vídeos prontos (READY) podem ser reproduzidos; os demais mostram o motivo.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load(entries)}>
          Atualizar vídeos
        </Button>
      </div>

      <form onSubmit={addCustom} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="gallery-custom-id">Consultar outro Video ID</Label>
          <Input id="gallery-custom-id" value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder="ex.: ThlVOZkDUF" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gallery-custom-profile">Perfil</Label>
          <select
            id="gallery-custom-profile"
            className="h-9 rounded-[var(--radius-1)] border border-border bg-input-background px-3 text-body-md focus-visible:ring-3 focus-visible:ring-ring/50"
            value={customProfile}
            onChange={(e) => setCustomProfile(e.target.value as Profile)}
          >
            {(["owner", "other", "anonymous"] as Profile[]).map((p) => (
              <option key={p} value={p}>{PROFILE_LABEL[p]}</option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="secondary">Adicionar</Button>
      </form>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => {
          const eff = e;
          const l = loaded[key(eff)];
          const meta = l && "meta" in l ? l.meta : undefined;
          const ready = meta?.status === "READY";
          return (
            <li key={key(e)}>
              <Card className="h-full" data-video={e.id}>
                {ready ? (
                  <video
                    controls
                    preload="none"
                    poster={mediaUrl(e.id, "thumbnail", eff.profile)}
                    src={mediaUrl(e.id, "stream", eff.profile)}
                    className="aspect-video w-full bg-black"
                    aria-label={`Player do vídeo ${e.id}`}
                  />
                ) : (
                  <PlaceholderReason loaded={l} />
                )}
                <div className="space-y-1 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-body-md">{e.id}</p>
                    {meta?.status ? <VideoStatusBadge status={meta.status} /> : null}
                  </div>
                  <p className="text-caption text-muted-foreground">{e.origin} · consultado como {PROFILE_LABEL[eff.profile]}</p>
                  {ready && (
                    <>
                      <p className="text-body-md">
                        {meta?.duration_seconds ?? "?"} s · {meta?.width ?? "?"}×{meta?.height ?? "?"} · {meta?.codec ?? "?"}
                      </p>
                      <a className="text-body-md text-link underline" href={mediaUrl(e.id, "download", eff.profile)}>
                        Baixar vídeo
                      </a>
                    </>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
