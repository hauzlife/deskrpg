"use client";
import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Camera,
  Compass,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  Activity,
  Gauge,
  Play,
  RefreshCw,
  Layers,
  Monitor,
  Smartphone,
  Sparkles,
  Cpu,
  Boxes,
  Info,
  CheckCircle2,
  StopCircle,
  RotateCcw,
} from "lucide-react";
import { OfficeRenderer } from "@/game/three/office-renderer";
import {
  OFFICE_ENVIRONMENTS,
  buildOfficeEnvironment,
  type OfficeEnvironmentId,
} from "@/game/three/office-environments";
import { OFFICE_ROOMS } from "@/game/three/office-room-layout";
import { roomLabel } from "@/game/three/room-labels";
import { tiledSnapshot } from "@/game/three/tiled-preview";
import { OFFICE_LOOKS, officeLookAppearance } from "@/game/three/office-looks";
import { furnitureSeats } from "@/game/three/seating";
import { findPath, clearSegment } from "@/game/navigation";
import type { ActorSnapshot, OfficeBridge } from "@/game/three/bridge";
import type { BenchmarkReport, FrameMetrics } from "@/game/three/frame-benchmark";
import "@/game/three/office.css";

import {
  studioReviewRooms,
  studioReviewSeatIndices,
  createReviewWalk,
  sampleReviewWalk,
} from "@/game/three/studio-review";

type SceneMode = "overview" | "close" | "moving";
const SCENES: SceneMode[] = ["overview", "close", "moving"];
type MatrixResult = {
  index: number;
  environment: OfficeEnvironmentId;
  scene: SceneMode;
  status: BenchmarkReport["status"];
  reason?: string;
  frameCount: number;
  captureMs: number;
  medianFps: number | null;
  averageFps: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  drawCallsMax: number;
  trianglesMax: number;
  viewport: FrameMetrics["viewport"] | undefined;
};
type MatrixProgress = {
  status: "running" | "complete" | "invalid";
  index: number;
  total: number;
  environment: OfficeEnvironmentId;
  scene: SceneMode;
  reason?: string;
  results: MatrixResult[];
};
function makeFixture(id: OfficeEnvironmentId) {
  const map = tiledSnapshot(buildOfficeEnvironment(id));
  const blocked = new Set(map.blocked);
  const walkable = (x: number, y: number) =>
    x >= 1 && x < map.cols - 1 && y >= 1 && y < map.rows - 1 && !blocked.has(`${x},${y}`);
  const seats = furnitureSeats(map.objects);
  const actors: ActorSnapshot[] = Array.from({ length: 12 }, (_, i) => {
    const seat = seats[id === "agency" ? studioReviewSeatIndices[i] : i % seats.length];
    return {
      id: `fixture-${i}`,
      name: i < 10 ? `NPC fixture ${i + 1}` : `Player fixture ${i - 9}`,
      kind: i < 10 ? "npc" : i === 10 ? "player" : "remote",
      x: (seat.anchorX ?? seat.x) * 32,
      y: (seat.anchorZ ?? seat.z) * 32,
      direction: seat.direction,
      walking: false,
      appearance: officeLookAppearance(OFFICE_LOOKS[i].id),
      bubble: i < 10 ? "Renderer check bubble" : undefined,
    };
  });
  const routes = actors.slice(0, 10).map((actor) => {
    const x = actor.x / 32 - 0.5,
      y = actor.y / 32 - 0.5;
    const path = findPath(x, y, Math.floor(map.cols / 2), map.rows - 3, walkable, (a, b) =>
      clearSegment(a, b, walkable),
    );
    if (!path) throw new Error(`No fixture path for ${actor.id}`);
    const roundTrip = [...path, ...path.slice(0, -1).reverse()];
    const lengths = roundTrip
      .slice(1)
      .map((p, i) => Math.hypot(p.x - roundTrip[i].x, p.y - roundTrip[i].y));
    return { points: roundTrip, lengths, total: lengths.reduce((a, b) => a + b, 0) };
  });
  return { map, walkable, actors, routes };
}
function moveFixture(fixture: ReturnType<typeof makeFixture>, seconds: number) {
  return fixture.actors.map((actor, index) => {
    const route = fixture.routes[index];
    if (!route || !route.total) return actor;
    let distance = (seconds * 1.6 + index * 0.7) % route.total;
    let segment = 0;
    while (segment < route.lengths.length - 1 && distance > route.lengths[segment])
      distance -= route.lengths[segment++];
    const a = route.points[segment],
      b = route.points[segment + 1];
    const progress = distance / Math.max(0.0001, route.lengths[segment]);
    return {
      ...actor,
      x: (a.x + (b.x - a.x) * progress + 0.5) * 32,
      y: (a.y + (b.y - a.y) * progress + 0.5) * 32,
      walking: true,
    };
  });
}

export default function ReviewClient() {
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null);
  const renderer = useRef<OfficeRenderer | null>(null);
  const runtime = useRef<{
    id: OfficeEnvironmentId;
    mode: SceneMode;
    generation: number;
    fixture: ReturnType<typeof makeFixture>;
  } | null>(null);
  const mounted = useRef(false);
  const matrixAbort = useRef<AbortController | null>(null);
  const [smallViewport, setSmallViewport] = useState(false);
  const [referenceViewport, setReferenceViewport] = useState(false);
  const playerWalk = useRef<{
    route: NonNullable<ReturnType<typeof createReviewWalk>>;
    start: number;
  } | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [matrix, setMatrix] = useState<MatrixProgress | null>(null);
  const [environment, setEnvironment] = useState<OfficeEnvironmentId>("publishing");
  const [mode, setMode] = useState<SceneMode>("overview");
  const [auditRoom, setAuditRoom] = useState<string>("");
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("Preparing renderer");
  const [report, setReport] = useState<unknown>(null);

  const frameRoom = (id: OfficeEnvironmentId, roomId: string) => {
    if (id === "agency") {
      const room = studioReviewRooms.find((r) => r.id === roomId);
      if (room) renderer.current?.showRoom(room.x, room.z, room.distance);
      else renderer.current?.showOverview();
      return;
    }
    const room = (OFFICE_ROOMS[id] ?? []).find((room) => room.id === roomId);
    if (!room) {
      renderer.current?.showOverview();
      return;
    }
    renderer.current?.showRoom(room.x + room.width / 2, room.z + room.depth / 2, 14);
  };
  const frameCamera = (id: OfficeEnvironmentId, scene: SceneMode) => {
    // Benchmark close scenes always use the meeting room, independent of the visual audit.
    if (scene === "close") frameRoom(id, "meeting");
    else renderer.current?.showOverview();
  };
  const resetAuditCamera = () => {
    setAuditRoom("");
    if (runtime.current) frameCamera(runtime.current.id, runtime.current.mode);
  };
  const selectEnvironment = (id: OfficeEnvironmentId, updateCamera = true) => {
    const current = runtime.current;
    if (!current) return;
    current.id = id;
    current.fixture = makeFixture(id);
    playerWalk.current = null;
    current.generation++;
    setEnvironment(id);
    if (updateCamera) frameCamera(id, current.mode);
  };
  useEffect(() => {
    mounted.current = true;
    runtime.current = {
      id: "publishing",
      mode: "overview",
      generation: 0,
      fixture: makeFixture("publishing"),
    };
    const instance = new OfficeRenderer(host.current!, labels.current!);
    renderer.current = instance;
    const bridge: OfficeBridge = {
      actors: () => {
        const r = runtime.current!;
        if (playerWalk.current) {
          r.fixture.actors[10] = sampleReviewWalk(
            playerWalk.current.route,
            (performance.now() - playerWalk.current.start) / 1000,
          );
          if (!r.fixture.actors[10].walking) playerWalk.current = null;
        }
        return r.mode === "moving"
          ? moveFixture(r.fixture, performance.now() / 1000)
          : r.fixture.actors;
      },
      mapKey: () => `${runtime.current!.id}:${runtime.current!.generation}`,
      map: () => runtime.current!.fixture.map,
      walkable: (x, y) => runtime.current!.fixture.walkable(x, y),
      editor: () => ({ placement: false, spawn: false, owner: false, tiled: true, seatLabels: [] }),
      pointer: (kind, x, y, button, _sx, _sy, actorId) => {
        const r = runtime.current!;
        if (
          kind !== "down" ||
          button !== 0 ||
          r.mode === "moving" ||
          (actorId && actorId !== "seat-target")
        )
          return;
        const now = performance.now();
        const current = playerWalk.current
          ? sampleReviewWalk(playerWalk.current.route, (now - playerWalk.current.start) / 1000)
          : r.fixture.actors[10];
        const route = createReviewWalk(current, x, y, r.fixture.walkable);
        if (route) {
          r.fixture.actors[10] = sampleReviewWalk(route, 0);
          playerWalk.current = { route, start: now };
        }
      },
      setPresentation: () => {},
    };
    instance.attach(bridge);
    instance.showOverview();
    const timer = window.setInterval(() => setMetrics(instance.readMetrics()), 500);
    setStatus("Check readiness, then start measuring.");
    return () => {
      mounted.current = false;
      matrixAbort.current?.abort("Review unmounted");
      clearInterval(timer);
      instance.dispose();
      renderer.current = null;
    };
  }, []);
  const metadata = () => ({
    fixture: "renderer fixture only; not real AI or multiplayer proof",
    environment: runtime.current?.id,
    scene: runtime.current?.mode,
    npcCount: 10,
    playerFixtureCount: 2,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    capturedAt: new Date().toISOString(),
    containerFixture: smallViewport
      ? "390x600 CSS pixels; not browser viewport or product mobile proof"
      : "responsive renderer container",
    browserViewport: { width: window.innerWidth, height: window.innerHeight },
    rendererContainer: { width: host.current?.clientWidth, height: host.current?.clientHeight },
  });
  const benchmark = () => {
    resetAuditCamera();
    setMatrix(null);
    const context = metadata();
    setBusy(true);
    setReport(null);
    setStatus("10 s warm-up + 30 s measurement. Keep the tab and window size unchanged.");
    try {
      renderer.current!.startBenchmark((result) => {
        if (!mounted.current) return;
        setReport({ ...context, benchmark: result });
        setBusy(false);
        setStatus(
          result.status === "complete"
            ? "Measurement complete"
            : `Measurement invalid: ${result.reason}`,
        );
      });
    } catch (error) {
      setBusy(false);
      setStatus(String(error));
    }
  };
  const benchmarkMatrix = async () => {
    if (matrixAbort.current || !renderer.current || !runtime.current) return;
    resetAuditCamera();
    const controller = new AbortController();
    matrixAbort.current = controller;
    const context = metadata();
    const raw: Array<{
      index: number;
      environment: OfficeEnvironmentId;
      scene: SceneMode;
      benchmark: BenchmarkReport;
    }> = [];
    let progress: MatrixProgress = {
      status: "running",
      index: 0,
      total: OFFICE_ENVIRONMENTS.length * SCENES.length,
      environment: runtime.current.id,
      scene: runtime.current.mode,
      results: [],
    };
    const initial = {
      width: host.current!.clientWidth,
      height: host.current!.clientHeight,
      browserWidth: window.innerWidth,
      browserHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
    };
    let capturing = false;
    const cancel = (reason: string) => {
      if (!controller.signal.aborted) controller.abort(reason);
      renderer.current?.cancelBenchmark(reason);
    };
    const guard = () => {
      if (!mounted.current || !renderer.current || !host.current)
        throw new Error("Renderer became unavailable");
      if (controller.signal.aborted) throw new Error(String(controller.signal.reason));
      if (document.hidden) throw new Error("Document became hidden");
      if (
        host.current.clientWidth !== initial.width ||
        host.current.clientHeight !== initial.height ||
        window.innerWidth !== initial.browserWidth ||
        window.innerHeight !== initial.browserHeight ||
        window.devicePixelRatio !== initial.dpr
      )
        throw new Error("Viewport, renderer container or device pixel ratio changed");
      if (capturing && !renderer.current.readMetrics().assetsReady)
        throw new Error("Actor assets or map became unavailable");
    };
    const monitor = () => {
      try {
        guard();
      } catch (error) {
        cancel(String(error));
      }
    };
    const visibility = () => {
      if (document.hidden) cancel("Document became hidden");
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", monitor);
    const monitorTimer = window.setInterval(monitor, 100);
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    setBusy(true);
    setReport(null);
    setMatrix(progress);
    try {
      guard();
      for (const entry of OFFICE_ENVIRONMENTS) {
        for (const scene of SCENES) {
          guard();
          progress = { ...progress, index: raw.length + 1, environment: entry.id, scene };
          setMatrix(progress);
          setStatus(
            `All ${progress.index}/${progress.total} · ${entry.nameEn} / ${scene} · waiting for assets`,
          );
          // Wait for the new map generation, rather than accepting the previous map's ready flag.
          selectEnvironment(entry.id, false);
          runtime.current!.mode = scene;
          setMode(scene);
          const mapKey = `${entry.id}:${runtime.current!.generation}`;
          const started = performance.now();
          while (true) {
            guard();
            const current = renderer.current!.readMetrics();
            if (current.mapKey === mapKey && current.assetsReady) break;
            if (performance.now() - started > 30000) throw new Error("Asset/map readiness timeout");
            await wait(100);
          }
          frameCamera(entry.id, scene);
          await wait(100);
          guard();
          capturing = true;
          setStatus(
            `All ${progress.index}/${progress.total} · ${entry.nameEn} / ${scene} · 10 s warm-up + 30 s measurement`,
          );
          const result = await new Promise<BenchmarkReport>((resolve) =>
            renderer.current!.startBenchmark(resolve),
          );
          capturing = false;
          if (!mounted.current) throw new Error("Review unmounted");
          raw.push({ index: progress.index, environment: entry.id, scene, benchmark: result });
          const summary: MatrixResult = {
            index: progress.index,
            environment: entry.id,
            scene,
            status: result.status,
            ...(result.reason ? { reason: result.reason } : {}),
            frameCount: result.frameCount,
            captureMs: result.captureMs,
            medianFps: result.medianFps,
            averageFps: result.averageFps,
            p95FrameMs: result.p95FrameMs,
            maxFrameMs: result.maxFrameMs,
            drawCallsMax: result.drawCallsMax,
            trianglesMax: result.trianglesMax,
            viewport: result.end?.viewport,
          };
          progress = { ...progress, results: [...progress.results, summary] };
          setMatrix(progress);
          if (result.status !== "complete") throw new Error(result.reason ?? "Benchmark invalid");
          guard();
        }
      }
      guard();
      progress = { ...progress, status: "complete" };
      setMatrix(progress);
      setReport({ ...context, matrixStatus: "complete", results: raw });
      setStatus(`All ${progress.total} scenes measured · expand the full frame JSON below.`);
    } catch (error) {
      cancel(String(error));
      if (mounted.current) {
        progress = { ...progress, status: "invalid", reason: String(error) };
        setMatrix(progress);
        setReport({
          ...context,
          matrixStatus: "invalid",
          reason: String(error),
          results: progress.results,
        });
        setStatus(
          `Full run stopped · ${progress.results.filter((result) => result.status === "complete").length}/${progress.total} scenes valid · ${String(error)}`,
        );
      }
    } finally {
      clearInterval(monitorTimer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", monitor);
      matrixAbort.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const transitions = async () => {
    resetAuditCamera();
    setMatrix(null);
    const original = runtime.current!.id;
    const context = metadata();
    const samples: { step: number; environment: string; metrics: FrameMetrics }[] = [];
    let hidden = document.hidden;
    const visibility = () => {
      if (document.hidden) hidden = true;
    };
    document.addEventListener("visibilitychange", visibility);
    setBusy(true);
    setReport(null);
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const settle = async () => {
      const started = performance.now();
      while (true) {
        if (!mounted.current) throw new Error("Review unmounted");
        if (hidden) throw new Error("Document became hidden");
        if (renderer.current!.readMetrics().assetsReady) break;
        if (performance.now() - started > 30_000) throw new Error("Asset/map readiness timeout");
        await wait(100);
      }
      await wait(2000);
      if (hidden) throw new Error("Document became hidden");
      if (!mounted.current || !renderer.current?.readMetrics().assetsReady)
        throw new Error("Renderer became unavailable");
      return renderer.current.readMetrics();
    };
    try {
      samples.push({ step: 0, environment: original, metrics: await settle() });
      const startIndex = OFFICE_ENVIRONMENTS.findIndex((entry) => entry.id === original);
      for (let step = 1; step <= 10; step++) {
        const id = OFFICE_ENVIRONMENTS[(startIndex + step) % OFFICE_ENVIRONMENTS.length].id;
        setStatus(`Live renderer map switch ${step}/10 · ${id}`);
        selectEnvironment(id);
        samples.push({ step, environment: id, metrics: await settle() });
      }
      const deltas = samples.slice(6).map((sample) => {
        const earlier = samples[sample.step - 5];
        return {
          environment: sample.environment,
          geometryDelta: sample.metrics.geometries - earlier.metrics.geometries,
          textureDelta: sample.metrics.textures - earlier.metrics.textures,
        };
      });
      setReport({
        ...context,
        transitionStatus: "complete",
        samples,
        sameMapSecondCycleDeltas: deltas,
        note: "Inspect same-map cycles for sustained growth; cache warm-up can establish a bounded plateau.",
      });
      setStatus("10 switches done · back to the original environment");
    } catch (error) {
      if (mounted.current) {
        setReport({ ...context, transitionStatus: "invalid", reason: String(error), samples });
        setStatus(String(error));
      }
    } finally {
      document.removeEventListener("visibilitychange", visibility);
      if (mounted.current) {
        if (runtime.current!.id !== original) selectEnvironment(original);
        setBusy(false);
      }
    }
  };
  return (
    <main className="theme-web min-h-screen bg-bg text-text p-4 md:p-6 lg:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-text flex items-center gap-2.5">
              <Layers className="text-primary" size={26} />
              <span>3D Studio & Architecture Review</span>
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Three.js WebGL Engine
            </span>
          </div>
          <p className="text-xs sm:text-sm text-text-muted mt-1.5 max-w-2xl">
            Visual inspection sandbox for office environments, spatial camera framing, actor layouts, and real-time GPU rendering telemetry.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-surface border border-border shadow-xs flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${metrics?.assetsReady ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500 animate-pulse"}`}
            />
            <span className="font-semibold text-text-secondary">
              {metrics?.assetsReady ? "Assets Ready" : "Preparing Renderer..."}
            </span>
          </div>
        </div>
      </header>

      {/* Control Ribbon Card */}
      <section className="bg-surface border border-border rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
          {/* Environment */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <Building2 size={14} className="text-primary" />
              Environment
            </label>
            <select
              aria-label="Environment"
              value={environment}
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg bg-surface-raised border border-border text-sm font-medium text-text focus:outline-hidden focus:ring-2 focus:ring-primary/40 transition-colors"
              onChange={(e) => {
                const id = e.target.value as OfficeEnvironmentId;
                selectEnvironment(id, !auditRoom);
                if (auditRoom) frameRoom(id, auditRoom);
              }}
            >
              {OFFICE_ENVIRONMENTS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.nameEn}
                </option>
              ))}
            </select>
          </div>

          {/* Scene Mode */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <Camera size={14} className="text-primary" />
              Scene Mode
            </label>
            <select
              aria-label="Scene"
              value={mode}
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg bg-surface-raised border border-border text-sm font-medium text-text focus:outline-hidden focus:ring-2 focus:ring-primary/40 transition-colors"
              onChange={(e) => {
                const next = e.target.value as SceneMode;
                runtime.current!.mode = next;
                setMode(next);
                setAuditRoom("");
                frameCamera(environment, next);
              }}
            >
              <option value="overview">Overview (Isometric)</option>
              <option value="close">Meeting Room Close-up</option>
              <option value="moving">10 NPCs Moving with Bubbles</option>
            </select>
          </div>

          {/* Room Inspector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <Compass size={14} className="text-primary" />
              Room Inspector
            </label>
            <select
              aria-label="Room inspection"
              value={auditRoom}
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg bg-surface-raised border border-border text-sm font-medium text-text focus:outline-hidden focus:ring-2 focus:ring-primary/40 transition-colors"
              onChange={(e) => {
                const roomId = e.target.value;
                setAuditRoom(roomId);
                if (roomId) frameRoom(environment, roomId);
                else frameCamera(environment, mode);
              }}
            >
              <option value="">Restore Scene Camera</option>
              {(environment === "agency" ? studioReviewRooms : (OFFICE_ROOMS[environment] ?? [])).map(
                (room) => (
                  <option key={room.id} value={room.id}>
                    {roomLabel(room.label, "en")}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>

        {/* Camera Tools Toolbar */}
        <div className="flex items-center gap-1.5 flex-wrap pt-2 lg:pt-0 lg:border-l lg:border-border lg:pl-4">
          <button
            type="button"
            disabled={busy}
            title="Rotate camera 90°"
            className="p-2 rounded-lg bg-surface-raised hover:bg-surface-raised/80 border border-border text-text transition-colors disabled:opacity-50"
            onClick={() => renderer.current?.rotateCamera(2)}
          >
            <RotateCw size={16} />
          </button>
          <button
            type="button"
            disabled={busy}
            title="Zoom In"
            className="p-2 rounded-lg bg-surface-raised hover:bg-surface-raised/80 border border-border text-text transition-colors disabled:opacity-50"
            onClick={() => renderer.current?.zoom(0.8)}
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            disabled={busy}
            title="Zoom Out"
            className="p-2 rounded-lg bg-surface-raised hover:bg-surface-raised/80 border border-border text-text transition-colors disabled:opacity-50"
            onClick={() => renderer.current?.zoom(1.25)}
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            disabled={busy}
            title="Reset scene camera"
            className="p-2 rounded-lg bg-surface-raised hover:bg-surface-raised/80 border border-border text-text transition-colors disabled:opacity-50"
            onClick={resetAuditCamera}
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            disabled={busy}
            title={showLabels ? "Hide Actor Labels" : "Show Actor Labels"}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${showLabels ? "bg-primary text-white border-primary" : "bg-surface-raised text-text border-border"}`}
            onClick={() => setShowLabels((v) => !v)}
          >
            {showLabels ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>Labels</span>
          </button>

          <button
            type="button"
            disabled={busy}
            title={smallViewport ? "Restore full size" : "Mobile preview (390px)"}
            className={`p-2 rounded-lg border transition-colors ${smallViewport ? "bg-primary text-white border-primary" : "bg-surface-raised text-text border-border"}`}
            onClick={() => {
              setSmallViewport((v) => !v);
              setReferenceViewport(false);
              setStatus(smallViewport ? "Default responsive container restored." : "Renderer container resized to 390×600 mobile check.");
            }}
          >
            {smallViewport ? <Monitor size={16} /> : <Smartphone size={16} />}
          </button>
        </div>
      </section>

      {/* Telemetry Strip Banner */}
      <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="p-3 rounded-xl bg-surface border border-border shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <Activity size={12} className="text-emerald-500" />
            Active Actors
          </span>
          <span className="text-lg font-bold text-text">
            {metrics ? `${metrics.actorCount} In Scene` : "12 In Scene"}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <Layers size={12} className="text-blue-500" />
            Draw Calls
          </span>
          <span className="text-lg font-bold text-text">
            {metrics?.drawCalls ?? "—"}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <Cpu size={12} className="text-purple-500" />
            Triangles
          </span>
          <span className="text-lg font-bold text-text">
            {metrics?.triangles ? `${Math.round(metrics.triangles / 1000)}k` : "—"}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <Boxes size={12} className="text-amber-500" />
            Geometries
          </span>
          <span className="text-lg font-bold text-text">
            {metrics?.geometries ?? "—"}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <Activity size={12} className="text-indigo-500" />
            Textures
          </span>
          <span className="text-lg font-bold text-text">
            {metrics?.textures ?? "—"}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border shadow-xs flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <Info size={12} className="text-teal-500" />
            Engine State
          </span>
          <span className="text-xs font-medium text-text-secondary truncate mt-1" title={status}>
            {status}
          </span>
        </div>
      </section>

      {/* 3D Canvas Box */}
      <section className="relative rounded-2xl border border-border bg-[#18181b] shadow-2xl overflow-hidden flex flex-col items-center justify-center min-h-[460px]">
        <div
          aria-label="Renderer check area"
          style={{
            position: "relative",
            pointerEvents: busy ? "none" : undefined,
            width: referenceViewport ? 1748 : smallViewport ? 390 : "100%",
            height: referenceViewport ? 900 : smallViewport ? 600 : "min(68vh, 760px)",
            minHeight: smallViewport ? 600 : 460,
          }}
          className="w-full flex justify-center items-center overflow-hidden transition-all duration-300"
        >
          <div ref={host} className="office-three-canvas w-full h-full" />
          <div
            ref={labels}
            className="office-actor-labels"
            style={{ visibility: showLabels ? "visible" : "hidden" }}
          />
        </div>
      </section>

      {/* Diagnostic Benchmarking & Engine Health */}
      <section className="bg-surface border border-border rounded-xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
              <Activity size={16} className="text-primary" />
              Engine Diagnostics & Performance Benchmarks
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Execute standardized frame rate probes, asset transitions, and multi-scene stress tests.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy || !metrics?.assetsReady || !showLabels}
              className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
              onClick={benchmark}
            >
              <Play size={13} />
              <span>Measure FPS</span>
            </button>
            <button
              type="button"
              disabled={busy || !metrics?.assetsReady || !showLabels}
              className="px-3 py-1.5 rounded-lg bg-surface-raised hover:bg-surface-raised/80 border border-border text-text text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
              onClick={benchmarkMatrix}
            >
              <Cpu size={13} />
              <span>All 15 Scenes</span>
            </button>
            <button
              type="button"
              disabled={busy || !metrics?.assetsReady}
              className="px-3 py-1.5 rounded-lg bg-surface-raised hover:bg-surface-raised/80 border border-border text-text text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
              onClick={transitions}
            >
              <RefreshCw size={13} />
              <span>Map Switch ×10</span>
            </button>
            {matrixAbort.current && (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-danger hover:bg-danger-hover text-white text-xs font-semibold transition-colors flex items-center gap-1.5"
                onClick={() => {
                  matrixAbort.current?.abort("Cancelled by user");
                  renderer.current?.cancelBenchmark("Cancelled by user");
                }}
              >
                <StopCircle size={13} />
                <span>Stop Run</span>
              </button>
            )}
          </div>
        </div>

        {/* Stress Test Matrix Progress */}
        {matrix && (
          <div className="p-4 rounded-lg bg-surface-raised border border-border flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-text">
                Status: <span className="text-primary uppercase">{matrix.status}</span> ({matrix.index}/{matrix.total})
              </span>
              <span className="text-text-muted">
                {matrix.environment} • {matrix.scene}
              </span>
            </div>
            {matrix.results.at(-1) && (
              <div className="text-xs text-text-secondary bg-surface p-2.5 rounded-md border border-border flex items-center justify-between">
                <span>Last Result: {matrix.results.at(-1)!.environment} / {matrix.results.at(-1)!.scene}</span>
                <span className="font-bold text-emerald-500">
                  {matrix.results.at(-1)!.medianFps?.toFixed(1) ?? "—"} Median FPS
                </span>
              </div>
            )}
          </div>
        )}

        {/* Collapsible Telemetry JSON Details */}
        <details className="text-xs text-text-muted">
          <summary className="cursor-pointer font-semibold hover:text-text transition-colors py-1">
            Raw Diagnostic JSON Telemetry ({metrics ? "Available" : "Empty"})
          </summary>
          <pre className="mt-2 p-3 rounded-lg bg-[#0f0f11] text-[#e4e4e7] border border-border font-mono text-[11px] overflow-auto max-h-60">
            {JSON.stringify(report ?? metrics, null, 2)}
          </pre>
        </details>
      </section>
    </main>
  );
}
