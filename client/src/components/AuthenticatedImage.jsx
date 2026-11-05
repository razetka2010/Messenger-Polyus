import { useEffect, useState } from "react";
import { fetchAccountResource, getActiveAccountKey } from "../apiClient.mjs";

export function useAuthenticatedResourceUrl(src, accountKey = getActiveAccountKey()) {
  const [resourceUrl, setResourceUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = null;
    if (!src?.startsWith("/api/")) {
      setResourceUrl(src || "");
      return () => { active = false; };
    }

    setResourceUrl("");
    fetchAccountResource(src, accountKey).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setResourceUrl(objectUrl);
    }).catch((error) => {
      if (active) console.error("Unable to load authenticated image:", error);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, accountKey]);

  return resourceUrl;
}

export default function AuthenticatedImage({ src, accountKey, ...props }) {
  const resourceUrl = useAuthenticatedResourceUrl(src, accountKey);
  return <img {...props} {...(resourceUrl ? { src: resourceUrl } : {})} />;
}

export function AuthenticatedVideo({ src, accountKey, ...props }) {
  const resourceUrl = useAuthenticatedResourceUrl(src, accountKey);
  return <video {...props} {...(resourceUrl ? { src: resourceUrl } : {})} />;
}
