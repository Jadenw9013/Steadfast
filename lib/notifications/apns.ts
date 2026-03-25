import jwt from "jsonwebtoken";
import http2 from "http2";

export async function sendPushNotification(deviceToken: string, payload: any) {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  let privateKey = process.env.APNS_PRIVATE_KEY;
  const bundleId = process.env.APNS_BUNDLE_ID;

  if (!teamId || !keyId || !privateKey || !bundleId) {
    console.warn("APNS environment variables not fully configured.");
    return { success: false, error: "Missing config" };
  }

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    privateKey = Buffer.from(privateKey, "base64").toString("utf-8");
  } else {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  const token = jwt.sign(
    {
      iss: teamId,
      iat: Math.floor(Date.now() / 1000),
    },
    privateKey,
    {
      algorithm: "ES256",
      header: {
        alg: "ES256",
        kid: keyId,
      },
    }
  );

  const isProd = process.env.NODE_ENV === "production";
  const host = isProd ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  
  return new Promise((resolve, reject) => {
    const client = http2.connect(host);

    client.on("error", (err) => {
      console.error("APNs HTTP/2 Connection Error:", err);
      reject(err);
    });

    const bodyData = JSON.stringify(payload);

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${token}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
    });

    request.on("response", (headers) => {
      const status = headers[":status"];
      let data = "";
      
      request.on("data", (chunk) => {
        data += chunk;
      });

      request.on("end", () => {
        client.close();
        if (status === 200) {
          resolve({ success: true, status });
        } else {
          console.error("APNs delivery failed:", status, data);
          resolve({ success: false, status, error: data });
        }
      });
    });

    request.on("error", (err) => {
      client.close();
      reject(err);
    });

    request.write(bodyData);
    request.end();
  });
}
