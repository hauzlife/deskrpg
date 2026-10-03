import Image from "next/image";

/**
 * Brand mark — a 3D miniature baked from the same three.js model as HQ, used below the sidebar.
 * The image is re-baked by `npx tsx scripts/brand-mark/render.ts` (model: game/three/office-building.ts).
 * Kept as a PNG so we don't fire up WebGL again on screen — even the 16px favicon comes from the same image.
 */
export default function DeskRpgMark({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center">
      <Image
        src="/assets/brand/rebel-mark.png"
        alt="Rebeltransfer"
        width={size}
        height={size}
        className="dark:hidden object-contain"
        priority
        aria-hidden="true"
      />
      <Image
        src="/assets/brand/rebel-mark-white.png"
        alt="Rebeltransfer"
        width={size}
        height={size}
        className="hidden dark:block object-contain"
        priority
        aria-hidden="true"
      />
    </span>
  );
}
