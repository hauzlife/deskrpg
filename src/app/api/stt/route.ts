import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("audio") as Blob | null;
    if (!file) {
      return NextResponse.json({ error: "no_audio" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const tempPath = path.join(os.tmpdir(), `deskrpg-stt-${Date.now()}.wav`);
    await fs.writeFile(tempPath, buffer);

    try {
      const mlxScript = "/Users/anonymous/bin/mlx_stt.py";
      const { stdout } = await execFileAsync(mlxScript, [tempPath], {
        env: {
          ...process.env,
          PATH: `/Users/anonymous/miniconda3/bin:${process.env.PATH}`,
        },
      });
      return NextResponse.json({ text: stdout.trim() });
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  } catch (err: any) {
    console.error("[STT error]", err);
    return NextResponse.json({ error: err.message || "stt_failed" }, { status: 500 });
  }
}
