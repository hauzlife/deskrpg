import Link from "next/link";
import DeskRpgMark from "@/components/DeskRpgMark";
import { ArrowLeft, Home } from "lucide-react";

export const metadata = {
  title: "404 — Page Not Found | DeskRPG for Hermes",
  description: "The requested virtual office desk or room could not be found.",
  robots: {
    index: false,
    follow: true,
  },
};

const ko = {
  heading: "사무실 공간을 찾을 수 없습니다",
  home: "메인으로 이동",
  auth: "로그인 / 오피스",
};

export default function NotFound() {
  return (
    <main className="theme-web min-h-screen flex flex-col items-center justify-center bg-bg text-text px-4 text-center">
      <div className="w-full max-w-md p-8 rounded-2xl bg-surface border border-border shadow-lg flex flex-col items-center">
        <div className="mb-4">
          <DeskRpgMark size={48} />
        </div>
        <span className="text-xs font-bold tracking-widest text-primary uppercase mb-2">
          DeskRPG Office Security
        </span>
        <h1 className="text-4xl font-extrabold tracking-tight text-text mb-2">
          404
        </h1>
        <p className="text-lg font-semibold text-text-secondary mb-1">
          {ko.heading}
        </p>
        <p className="text-sm text-text-dim mb-6">
          Room or resource not found on this floor.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <Link
            href="/"
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white font-medium text-sm transition-colors"
          >
            <Home size={16} aria-hidden="true" />
            <span>{ko.home}</span>
          </Link>
          <Link
            href="/auth"
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-surface-raised hover:bg-surface-raised/80 text-text border border-border font-medium text-sm transition-colors"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>{ko.auth}</span>
          </Link>
        </div>
      </div>
      <footer className="mt-8 text-xs text-text-dim">
        HERMES × YOUR LITTLE WORLD · 404 RESILIENCE
      </footer>
    </main>
  );
}
