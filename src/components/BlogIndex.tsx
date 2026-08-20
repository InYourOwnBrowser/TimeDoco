import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BlogLayout } from './BlogLayout';

// Fetch all MDX files
const modules = import.meta.glob('../blog/*.mdx', { eager: true });

export const posts = Object.entries(modules)
  .filter(([path]) => !path.includes('/templates/') && !path.includes('/_'))
  .map(([path, module]: [string, any]) => ({
    slug: path.replace('../blog/', '').replace('.mdx', ''),
    ...module.meta,
    Component: module.default,
  }))
  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

export const BlogIndex: React.FC = () => {
  const [search, setSearch] = useState('');

  const filteredPosts = posts.filter(post =>
    post.title?.toLowerCase().includes(search.toLowerCase()) ||
    post.tags?.some((tag: string) => tag.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <BlogLayout>
      <div className="max-w-3xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-extrabold mb-8 text-graphite dark:text-stone">TimeDoco Blog &amp; Guides</h1>
        <input
          type="text"
          className="w-full p-3 mb-8 border border-graphite/20 dark:border-white/20 rounded-panel dark:bg-graphite/80 dark:text-stone shadow-sm focus:outline-none focus:ring-2 focus:ring-signal"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search posts or tags..."
        />
        <div className="grid gap-6">
          {filteredPosts.map(post => (
            <Link className="block p-6 rounded-panel border border-graphite/10 dark:border-white/10 hover:border-signal/50 transition-all bg-stone/50 dark:bg-graphite/40 shadow-sm" key={post.slug} to={`/blog/${post.slug}`}>
              <h2 className="text-2xl font-bold mb-2 text-graphite dark:text-stone hover:text-signal transition-colors">{post.title}</h2>
              <p className="text-xs text-signal font-mono mb-4">{post.date}</p>
              <div className="flex gap-2">
                {post.tags?.map((tag: string) => (
                  <span key={tag} className="px-2.5 py-1 bg-graphite/10 dark:bg-white/10 rounded text-xs text-gray-700 dark:text-gray-300 font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </BlogLayout>
  );
};
