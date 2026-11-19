'use client';

/** Wspólny nagłówek marki dla ekranów logowania / rejestracji / ładowania. */
export default function BrandHeader({ subtitle, small = false }) {
  return (
    <div className="stagger flex flex-col items-center text-center mb-6">
      <img
        src="/logo.png"
        alt="Sieje Hot Crew"
        className={`${small ? 'w-16' : 'w-24'} h-auto select-none drop-shadow-[0_4px_20px_rgba(0,0,0,0.7)]`}
        draggable={false}
      />
      <h1 className="font-display text-4xl font-bold tracking-[0.35em] text-paper-100 mt-3 pl-[0.35em]">
        MAFIA
      </h1>
      <div className="ornament w-48 mt-2">IRL</div>
      {subtitle && <p className="text-paper-200/50 text-sm mt-4">{subtitle}</p>}
    </div>
  );
}
