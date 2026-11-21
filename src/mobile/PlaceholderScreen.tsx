/** Empty tab (Map / Stories / Spotlight): just the tab name, centred. */
export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <section className="m-placeholder" aria-label={title}>
      <h1 className="m-placeholder__title">{title}</h1>
    </section>
  );
}
