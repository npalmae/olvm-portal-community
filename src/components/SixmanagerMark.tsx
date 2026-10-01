import Image from "next/image";

type SixmanagerMarkProps = {
  compact?: boolean;
  subtitle?: string;
  align?: "left" | "center";
  name?: string;
};

export function SixmanagerMark({
  compact = false,
  subtitle,
  align = "left",
  name = "Virtual Portal",
}: SixmanagerMarkProps) {
  const isCenter = align === "center";

  return (
    <div className={isCenter ? "text-center" : ""}>
      <div className={`flex items-center gap-3 ${isCenter ? "justify-center" : ""}`}>
        <Image
          src="/logo-vp-mark.svg"
          alt="Virtual Portal"
          width={512}
          height={512}
          priority
          className={`h-auto ${compact ? "w-11" : "w-14"} drop-shadow-[0_18px_35px_rgba(0,0,0,0.35)]`}
        />
        <span
          className={`bg-gradient-to-r from-violet-600 via-purple-600 to-violet-500 bg-clip-text font-semibold tracking-tight text-transparent ${
            compact ? "text-lg" : "text-xl"
          }`}
        >
          {name}
        </span>
      </div>
      {subtitle ? (
        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-violet-300/70">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
