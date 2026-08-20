import React from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { posts } from './BlogIndex';
import { BlogLayout } from './BlogLayout';

const BASE = import.meta.env.BASE_URL ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

export const BlogPost: React.FC = () => {
  const { slug } = useParams();
  const post = posts.find(p => p.slug === slug);

  if (!post) {
    return <Navigate replace to="/blog"/>;
  }

  const { Component } = post;

  return (
    <BlogLayout>
      <div className="max-w-3xl mx-auto py-12 px-4">
        <article className="prose dark:prose-invert max-w-none">
          <Component/>
        </article>

        <div className="mt-12 pt-8 border-t border-graphite/10 dark:border-white/10 flex justify-between items-center">
          <Link to="/blog" className="text-sm font-semibold text-signal hover:underline">&larr; Back to Blog Index</Link>
          <a href={`${BASE}/app/`} className="px-4 py-2 rounded-panel bg-signal text-ink font-bold text-sm hover:bg-amber-600 transition-colors">
            Try TimeDoco Free
          </a>
        </div>
      </div>
    </BlogLayout>
  );
};
