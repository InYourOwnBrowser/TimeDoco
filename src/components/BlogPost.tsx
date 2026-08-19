import React from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { posts } from './BlogIndex';

export const BlogPost: React.FC = () => {
  const { slug } = useParams();
  const post = posts.find(p => p.slug === slug);

  if (!post) {
    return <Navigate replace to="/blog"/>;
  }

  const { Component } = post;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Link to="/blog" className="text-signal hover:underline text-sm font-semibold mb-6 inline-block">&larr; Back to Blog Index</Link>
      <article className="prose dark:prose-invert max-w-none">
        <Component/>
      </article>
    </div>
  );
};
