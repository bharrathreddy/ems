import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import { PageHeader } from '../components/ui';
import HomeTab from './website/HomeTab';
import { ContactTab, EventsTab, GalleryTab, MenusTab, MessagesTab, PagesTab, VideosTab } from './website/Tabs';

const TABS = [['home', 'Home page'], ['pages', 'Pages'], ['menus', 'Menus'], ['events', 'Events'], ['gallery', 'Gallery'], ['videos', 'Videos'], ['messages', 'Messages'], ['contact', 'Contact & social']] as const;

export default function WebsitePage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('home');
  return (
    <div>
      <PageHeader title="Website" description="Everything visitors see on the school website. Changes show immediately." action={<a href="/" target="_blank" rel="noreferrer" className="btn-quiet"><ExternalLink size={16} aria-hidden />Open website</a>} />
      <div className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-[15px] font-semibold', tab === k ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink')}>{label}</button>)}
      </div>
      {tab === 'home' && <HomeTab />}{tab === 'pages' && <PagesTab />}{tab === 'menus' && <MenusTab />}{tab === 'events' && <EventsTab />}
      {tab === 'gallery' && <GalleryTab />}{tab === 'videos' && <VideosTab />}{tab === 'messages' && <MessagesTab />}{tab === 'contact' && <ContactTab />}
    </div>
  );
}
