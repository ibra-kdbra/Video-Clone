/**
 * The categories. "Trending" reads each platform's popular list (no search needed); the others
 * are searches, which the server caches for a day, so each costs at most one of YouTube's 100
 * free daily searches however many people open it.
 */
export const CATEGORIES = [
  { slug: 'trending', label: 'Trending', trending: true, blurb: 'What people are watching right now.' },
  { slug: 'music', label: 'Music', query: 'live music session', blurb: 'Live sessions, new releases and performances.' },
  { slug: 'gaming', label: 'Gaming', query: 'gaming highlights', blurb: 'Highlights, playthroughs and the best moments.' },
  { slug: 'science', label: 'Science', query: 'science explained', blurb: 'Big ideas, clearly explained.' },
  { slug: 'coding', label: 'Coding', query: 'programming tutorial', blurb: 'Tutorials, talks and deep dives for developers.' },
  { slug: 'design', label: 'Design', query: 'design process', blurb: 'How great products, brands and spaces get made.' },
  { slug: 'travel', label: 'Travel', query: 'travel documentary', blurb: 'Places worth the trip, and the stories behind them.' },
  { slug: 'cooking', label: 'Cooking', query: 'cooking recipe', blurb: 'Recipes, techniques and kitchens around the world.' },
  { slug: 'comedy', label: 'Comedy', query: 'stand up comedy', blurb: 'Stand-up, sketches and things that made us laugh.' },
  { slug: 'sports', label: 'Sports', query: 'sports highlights', blurb: 'Highlights, analysis and the plays everyone replays.' },
  { slug: 'fitness', label: 'Fitness', query: 'home workout', blurb: 'Workouts you can do anywhere.' },
  { slug: 'podcasts', label: 'Podcasts', query: 'podcast episode', blurb: 'Long conversations, worth the time.' },
];

export const TRENDING = CATEGORIES[0];

export const categoryBySlug = (slug) => CATEGORIES.find((c) => c.slug === slug) ?? null;

/** The rows under the billboard on the home page, loaded as they scroll into view. */
export const HOME_ROWS = ['music', 'gaming', 'science', 'coding', 'travel', 'comedy'];
