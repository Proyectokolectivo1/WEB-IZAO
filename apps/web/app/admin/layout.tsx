import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './admin.css';
import './crud.css';

export const metadata: Metadata = {
  title: { default: 'Panel', template: '%s · Panel Izao' },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="adm">{children}</div>;
}
