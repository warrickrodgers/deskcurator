// Performance tracking utility

let totalTokens = 0;

export function trackTokens(tokens: number) {
  totalTokens += tokens;
  console.log(`Tokens used: ${tokens}, Total: ${totalTokens}`);
}
