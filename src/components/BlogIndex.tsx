import React, { useState } from 'react';
import { Link } from 'react-router-dom';

// Fetch all MDX files
const modules = import.meta.glob('../blog/*.mdx', { eager: true });

export const posts = Object.entries(modules).map(([path, module]: [string, any]) => ({
  slug: path.replace('../blog/', '').replace('.mdx', ''),
  ...module.meta,
  Component: module.default,
}));

export const BlogIndex: React.FC = () => {
  const [search, setSearch] = useState('');

  const filteredPosts = posts.filter(post =>
    post.title?.toLowerCase().includes(search.toLowerCase()) ||
    post.tags?.some((tag: string) => tag.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6 text-graphite dark:text-stone">Blog</h1>
      <input
        type="text"
        className="w-full p-2 mb-8 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-stone"
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search posts or tags..."
      />
      <div className="grid gap-6">
        {filteredPosts.map(post => (
          <Link className="block p-6 border rounded hover:shadow-lg transition-shadow dark:border-gray-700 bg-white/50 dark:bg-graphite/40" key={post.slug} to={`/blog/${post.slug}`}>
            <h2 className="text-2xl font-semibold mb-2 text-graphite dark:text-stone">{post.title}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{post.date}</p>
            <div className="flex gap-2">
              {post.tags?.map((tag: string) => (
                <span key={tag} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs text-gray-800 dark:text-gray-200">
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};
