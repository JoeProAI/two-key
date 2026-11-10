export function HeroPlate() {
  return (
    <figure className="plate">
      <picture>
        <source
          media="(max-width: 767px)"
          type="image/avif"
          srcSet="/hero/held-for-review-mobile-600.avif 600w, /hero/held-for-review-mobile-1200.avif 1200w"
          sizes="100vw"
        />
        <source
          media="(max-width: 767px)"
          type="image/webp"
          srcSet="/hero/held-for-review-mobile-600.webp 600w, /hero/held-for-review-mobile-1200.webp 1200w"
          sizes="100vw"
        />
        <source
          type="image/avif"
          srcSet="/hero/held-for-review-desktop-800.avif 800w, /hero/held-for-review-desktop-1200.avif 1200w"
          sizes="(min-width: 1024px) 52vw, 100vw"
        />
        <source
          type="image/webp"
          srcSet="/hero/held-for-review-desktop-800.webp 800w, /hero/held-for-review-desktop-1200.webp 1200w"
          sizes="(min-width: 1024px) 52vw, 100vw"
        />
        <img
          src="/hero/held-for-review-desktop-1200.jpg"
          alt=""
          width={1200}
          height={800}
          fetchPriority="high"
          decoding="async"
        />
      </picture>
      <figcaption>Illustrative scene, not transaction evidence.</figcaption>
    </figure>
  );
}
