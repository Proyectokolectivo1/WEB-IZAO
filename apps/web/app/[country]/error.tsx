'use client';

import { Button } from '@izao/ui';
import { T } from '@/lib/store/textos';

export default function ErrorPais({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[50dvh] max-w-3xl flex-col items-start justify-center gap-5 px-6 py-20">
      <h1 className="text-4xl">{T.errores.generico}</h1>
      <Button onClick={reset}>{T.listado.reintentar}</Button>
    </div>
  );
}
