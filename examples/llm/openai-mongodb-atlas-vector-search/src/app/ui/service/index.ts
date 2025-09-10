import axios from 'axios';
import { Post } from '@/app/lib/types/post';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL 

export const fetchPosts = async (): Promise<Post[]> => {
  const response = await axios.get(`${API_BASE_URL}/api/posts`);
  return response.data;
};
