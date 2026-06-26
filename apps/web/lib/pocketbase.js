import PocketBase from 'pocketbase';

const pb = new PocketBase(
  process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'
);

if (typeof window !== 'undefined') {
  pb.autoCancellation(false);
}

export default pb;
