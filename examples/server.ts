import { createClient, getCurrentAppId } from '@tier0/sdk-v2';

// In a Tier0 Preview or deployment the platform sets TIER0_API_HOST and TIER0_APP_ID and its node
// proxy attaches the App credential: no key. For local development set TIER0_API_HOST and TIER0_API_KEY.
const tier0 = createClient();

export async function readOrders(signal?: AbortSignal) {
  return tier0.uns.recordFind({ collectionId: 'orders', limit: 20 }, { signal });
}

export async function notifyCompletion(recipientUserId: string, orderId: string) {
  return tier0.notifications.send({
    recipientUserId,
    title: 'Order completed',
    content: `Order ${orderId} is complete.`,
    type: 'business',
    idempotencyKey: `order-${orderId}-completed`,
    sender: { type: 'app', id: getCurrentAppId() },
  });
}
