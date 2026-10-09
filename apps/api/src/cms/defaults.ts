/** Starter website content for a new installation. Everything here is editable in Website settings. */
export const HOME_SECTIONS: Array<{ key: string; visible: boolean; content: Record<string, unknown> }> = [
  { key: 'banner', visible: true, content: { autoplaySeconds: 6, slides: [
    { imageId: null, heading: 'Welcome to our school', text: 'Learning with care, discipline and joy.', buttonLabel: 'Admissions', buttonLink: '/contact' },
  ] } },
  { key: 'welcome', visible: true, content: { heading: 'About our school', imageId: null, linkLabel: 'Read more', link: '/about',
    text: 'Write two or three sentences about your school here: when it started, what it believes in, and what makes it special.' } },
  { key: 'principal', visible: true, content: { heading: "Principal's message", name: 'Principal name', designation: 'Principal', photoId: null,
    message: 'A short welcome from the principal, shown on the home page.', fullMessage: 'The full message from the principal, shown on the About page.' } },
  { key: 'highlights', visible: true, content: { items: [
    { value: '1,000+', label: 'Students' }, { value: '50+', label: 'Teachers' }, { value: '25', label: 'Years' }, { value: '100%', label: 'SSC pass' },
  ] } },
  { key: 'facilities', visible: true, content: { heading: 'Facilities', items: [
    { title: 'Science labs', text: 'Hands-on experiments in physics, chemistry and biology.', imageId: null },
    { title: 'Library', text: 'Thousands of books in English and Telugu.', imageId: null },
    { title: 'Transport', text: 'Safe school buses on routes across the town.', imageId: null },
    { title: 'Playground', text: 'Sports, games and yoga every week.', imageId: null },
  ] } },
  { key: 'notices', visible: true, content: { heading: 'Latest notices', count: 3 } },
  { key: 'events', visible: true, content: { heading: 'Events', count: 3 } },
  { key: 'gallery', visible: true, content: { heading: 'Gallery', count: 8 } },
  { key: 'videos', visible: true, content: { heading: 'Videos', count: 3 } },
  { key: 'testimonials', visible: false, content: { heading: 'What parents say', items: [
    { name: 'Parent name', relation: 'Parent of a Class 5 student', text: 'A short quote from a parent.' },
  ] } },
  { key: 'admissions', visible: true, content: { heading: 'Admissions open', text: 'Visit the school office or send us a message to know more.', buttonLabel: 'Enquire now', buttonLink: '/contact' } },
];

export const PAGES = [
  { slug: 'home', kind: 'home' as const, title: 'Home', body: null },
  { slug: 'about', kind: 'about' as const, title: 'About us', body:
`## Our story
Write about how and when the school started.

## Vision
What the school wants every student to become.

## Mission
- How the school teaches
- What it values
- How it works with families` },
  { slug: 'contact', kind: 'contact' as const, title: 'Contact us', body: null },
  { slug: 'privacy', kind: 'privacy' as const, title: 'Privacy policy', body:
`This policy explains how the school uses information on this website and in the school app. Please review it and change it to match your school.

## What we collect
- Messages you send through the contact form (name, mobile number and message)
- Student and family details provided at admission, used to run the school

## How we use it
- To reply to your enquiry
- To manage admissions, fees, attendance and communication with families

## Sharing
We do not sell personal information. We share it only when required by law or education authorities.

## Children's information
Information about students is collected with the consent of their parents or guardians and is used only for school purposes.

## Contact
For questions about this policy, contact the school office.` },
];

export const MENUS: Array<{ location: 'header' | 'footer'; label: string; link_type: 'page' | 'builtin' | 'url'; target: string }> = [
  { location: 'header', label: 'Home', link_type: 'builtin', target: 'home' },
  { location: 'header', label: 'About', link_type: 'page', target: 'about' },
  { location: 'header', label: 'Events', link_type: 'builtin', target: 'events' },
  { location: 'header', label: 'Gallery', link_type: 'builtin', target: 'gallery' },
  { location: 'header', label: 'Videos', link_type: 'builtin', target: 'videos' },
  { location: 'header', label: 'Contact', link_type: 'builtin', target: 'contact' },
  { location: 'footer', label: 'About us', link_type: 'page', target: 'about' },
  { location: 'footer', label: 'Contact', link_type: 'builtin', target: 'contact' },
  { location: 'footer', label: 'Privacy policy', link_type: 'page', target: 'privacy' },
];
