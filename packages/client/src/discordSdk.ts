import { DiscordSDK } from "@discord/embedded-app-sdk";

export interface AuthData {
  access_token: string;
  user: {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  };
}

let _sdk: DiscordSDK | null = null;

export function getDiscordSdk(): DiscordSDK {
  if (!_sdk) {
    _sdk = new DiscordSDK(import.meta.env.VITE_CLIENT_ID);
  }
  return _sdk;
}

// Keep a reference for hooks that need it (instanceId etc.)
export let discordSdk: DiscordSDK;

export async function setupDiscordSdk(): Promise<AuthData> {
  console.log("[SDK] Params:", window.location.search);
  console.log("[SDK] Client ID:", import.meta.env.VITE_CLIENT_ID);

  discordSdk = new DiscordSDK(import.meta.env.VITE_CLIENT_ID);

  console.log("[SDK] Waiting for ready...");
  await discordSdk.ready();
  console.log("[SDK] Ready. Authorizing...");

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });
  console.log("[SDK] Got code, exchanging token...");

  const res = await fetch("/.proxy/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const { access_token } = await res.json();
  console.log("[SDK] Token received. Authenticating...");

  const auth = await discordSdk.commands.authenticate({ access_token });
  console.log("[SDK] Auth complete.");

  return {
    access_token,
    user: {
      id: auth.user.id,
      username: auth.user.username,
      global_name: auth.user.global_name ?? null,
      avatar: auth.user.avatar ?? null,
    },
  };
}
