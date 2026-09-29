/**
 * The home page's categories. "Trending" reads each platform's popular list (no search needed);
 * the others are searches, which the server caches for a day, so each costs at most one of
 * YouTube's 100 free daily searches however many people open it.
 */
export const CATEGORIES = [
  { slug: 'trending', label: 'Trending', trending: true },
  { slug: 'coding', label: 'Coding', query: 'programming tutorial' },
  { slug: 'music', label: 'Music', query: 'live music session' },
  { slug: 'gaming', label: 'Gaming', query: 'gaming highlights' },
  { slug: 'science', label: 'Science', query: 'science explained' },
  { slug: 'design', label: 'Design', query: 'design process' },
  { slug: 'podcasts', label: 'Podcasts', query: 'podcast episode' },
  { slug: 'sports', label: 'Sports', query: 'sports highlights' },
  { slug: 'cooking', label: 'Cooking', query: 'cooking recipe' },
  { slug: 'travel', label: 'Travel', query: 'travel documentary' },
  { slug: 'comedy', label: 'Comedy', query: 'stand up comedy' },
  { slug: 'fitness', label: 'Fitness', query: 'home workout' },
];

export const categoryBySlug = (slug) => CATEGORIES.find((c) => c.slug === slug) ?? CATEGORIES[0];
