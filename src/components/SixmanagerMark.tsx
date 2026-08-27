import Image from "next/image";

type SixmanagerMarkProps = {
  compact?: boolean;
  subtitle?: string;
  align?: "left" | "center";
};

export function SixmanagerMark({
  compact = false,
  subtitle,
  align = "left",
}: SixmanagerMarkProps) {
  const isCenter = align === "center";

  return (
    <div className={isCenter ? "text-center" : ""}>
      <div className={`flex ${isCenter ? "justify-center" : ""}`}>
        <Image
          src="/sixmanager-logo.png"
          alt="Sixmanager"
          width={589}
          height={393}
          priority
          className={`h-auto ${
            compact ? "w-[90px] sm:w-[110px]" : "w-[130px] sm:w-[160px]"
          } drop-shadow-[0_18px_35px_rgba(0,0,0,0.35)]`}
        />
      </div>
      {subtitle ? (
        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-emerald-200/70">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
