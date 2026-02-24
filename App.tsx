import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import { clusterApiUrl, Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Platform, ScrollView, Text, View } from "react-native";
import nacl from "tweetnacl";

import {
  DEFAULT_APP_URL,
  INVALID_URL,
  OK_ORIGIN_MISMATCH_APP_URL,
  ORIGIN_MISMATCH_WRONG_DEEPLINK_APP_URL,
  SPOOF_REDIRECT_SIGN_ALL_TRANSACTIONS,
  SPOOF_REDIRECT_SIGN_MESSAGE,
  SPOOF_REDIRECT_SIGN_TRANSACTION,
} from "./constants/deeplinks";

global.Buffer = global.Buffer || Buffer;

const NETWORK = clusterApiUrl("mainnet-beta");

const onConnectRedirectLink = Linking.createURL("onConnect");
const onDisconnectRedirectLink = Linking.createURL("onDisconnect");
const onSignInRedirectLink = Linking.createURL("onSignIn");
const onSignAndSendTransactionRedirectLink = Linking.createURL("onSignAndSendTransaction");
const onSignAllTransactionsRedirectLink = Linking.createURL("onSignAllTransactions");
const onSignTransactionRedirectLink = Linking.createURL("onSignTransaction");
const onSignMessageRedirectLink = Linking.createURL("onSignMessage");

/**
 * If true, uses universal links instead of deep links. This is the recommended way for dapps
 * and Phantom to handle deeplinks as we own the phantom.app domain.
 *
 * Set this to false to use normal deeplinks, starting with phantom://. This is easier for
 * debugging with a local build such as Expo Dev Client builds.
 */
const useUniversalLinks = false;
const buildUrl = (path: string, params: URLSearchParams) =>
  `${useUniversalLinks ? "https://phantom.app/ul/" : "phantom://"}v1/${path}?${params.toString()}`;

type DeeplinkParamOverrides = {
  appUrlOverride?: string;
  redirectLinkOverride?: string;
};

const getAppUrl = (appUrlOverride?: string) => appUrlOverride ?? DEFAULT_APP_URL;
const getRedirectLink = (defaultRedirectLink: string, redirectLinkOverride?: string) =>
  redirectLinkOverride ?? defaultRedirectLink;

const decryptPayload = (data: string, nonce: string, sharedSecret?: Uint8Array) => {
  if (!sharedSecret) throw new Error("missing shared secret");

  const decryptedData = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), sharedSecret);
  if (!decryptedData) {
    throw new Error("Unable to decrypt data");
  }
  return JSON.parse(Buffer.from(decryptedData).toString("utf8"));
};

const encryptPayload = (payload: any, sharedSecret?: Uint8Array) => {
  if (!sharedSecret) throw new Error("missing shared secret");

  const nonce = nacl.randomBytes(24);

  const encryptedPayload = nacl.box.after(
    Buffer.from(JSON.stringify(payload)),
    nonce,
    sharedSecret,
  );

  return [nonce, encryptedPayload];
};

export default function App() {
  const [deepLink, setDeepLink] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const connection = new Connection(NETWORK);
  const addLog = useCallback((log: string) => setLogs((logs) => [...logs, "> " + log]), []);
  const clearLog = useCallback(() => setLogs(() => []), []);
  const scrollViewRef = useRef<any>(null);

  // store dappKeyPair, sharedSecret, session and account SECURELY on device
  // to avoid having to reconnect users.
  const [dappKeyPair] = useState(nacl.box.keyPair());
  const [sharedSecret, setSharedSecret] = useState<Uint8Array>();
  const [session, setSession] = useState<string>();
  const [phantomWalletPublicKey, setPhantomWalletPublicKey] = useState<PublicKey>();

  useEffect(() => {
    (async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        setDeepLink(initialUrl);
      }
    })();
    const subscription = Linking.addEventListener("url", handleDeepLink);
    return () => {
      subscription.remove();
    };
  }, []);

  const handleDeepLink = ({ url }: Linking.EventType) => {
    setDeepLink(url);
  };

  // handle inbounds links
  useEffect(() => {
    if (!deepLink) return;

    const url = new URL(deepLink);
    const params = url.searchParams;

    if (params.get("errorCode")) {
      addLog(JSON.stringify(Object.fromEntries([...params]), null, 2));
      return;
    }

    if (/onConnect/.test(url.pathname || url.host)) {
      const sharedSecretDapp = nacl.box.before(
        bs58.decode(params.get("phantom_encryption_public_key")!),
        dappKeyPair.secretKey,
      );

      const connectData = decryptPayload(
        params.get("data")!,
        params.get("nonce")!,
        sharedSecretDapp,
      );

      setSharedSecret(sharedSecretDapp);
      setSession(connectData.session);
      setPhantomWalletPublicKey(new PublicKey(connectData.public_key));

      addLog(JSON.stringify(connectData, null, 2));
    } else if (/onSignIn/.test(url.pathname || url.host)) {
      const sharedSecretDapp = nacl.box.before(
        bs58.decode(params.get("phantom_encryption_public_key")!),
        dappKeyPair.secretKey,
      );

      const signInData = decryptPayload(
        params.get("data")!,
        params.get("nonce")!,
        sharedSecretDapp,
      );
      const walletAddress = signInData.address ?? signInData.public_key;

      setSharedSecret(sharedSecretDapp);
      setSession(signInData.session);
      if (walletAddress) {
        setPhantomWalletPublicKey(new PublicKey(walletAddress));
      }

      addLog(JSON.stringify(signInData, null, 2));
    } else if (/onDisconnect/.test(url.pathname || url.host)) {
      addLog("Disconnected!");
    } else if (/onSignAndSendTransaction/.test(url.pathname || url.host)) {
      const signAndSendTransactionData = decryptPayload(
        params.get("data")!,
        params.get("nonce")!,
        sharedSecret,
      );

      addLog(JSON.stringify(signAndSendTransactionData, null, 2));
    } else if (/onSignAllTransactions/.test(url.pathname || url.host)) {
      const signAllTransactionsData = decryptPayload(
        params.get("data")!,
        params.get("nonce")!,
        sharedSecret,
      );

      const decodedTransactions = signAllTransactionsData.transactions.map((t: string) =>
        Transaction.from(bs58.decode(t)),
      );

      addLog(JSON.stringify(decodedTransactions, null, 2));
    } else if (/onSignTransaction/.test(url.pathname || url.host)) {
      const signTransactionData = decryptPayload(
        params.get("data")!,
        params.get("nonce")!,
        sharedSecret,
      );

      const decodedTransaction = Transaction.from(bs58.decode(signTransactionData.transaction));

      addLog(JSON.stringify(decodedTransaction, null, 2));
    } else if (/onSignMessage/.test(url.pathname || url.host)) {
      const signMessageData = decryptPayload(
        params.get("data")!,
        params.get("nonce")!,
        sharedSecret,
      );

      addLog(JSON.stringify(signMessageData, null, 2));
    }
  }, [deepLink]);

  const getRecentBlockhash = async () => {
    addLog("Getting recent blockhash");
    return (await connection.getLatestBlockhash()).blockhash;
  };

  const createTransferTransaction = async (recentBlockhash: string) => {
    if (!phantomWalletPublicKey) throw new Error("missing public key from user");
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: phantomWalletPublicKey,
        toPubkey: phantomWalletPublicKey,
        lamports: 100,
      }),
    );
    transaction.feePayer = phantomWalletPublicKey;
    const anyTransaction: any = transaction;
    anyTransaction.recentBlockhash = recentBlockhash;
    return transaction;
  };

  const createAuthParams = (
    redirectLink: string,
    overrides?: DeeplinkParamOverrides,
    payload?: string,
  ) => {
    const params = new URLSearchParams({
      dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
      cluster: "mainnet-beta",
      app_url: getAppUrl(overrides?.appUrlOverride),
      redirect_link: getRedirectLink(redirectLink, overrides?.redirectLinkOverride),
    });

    if (payload) params.set("payload", payload);
    return params;
  };

  const createSignInPayload = () => {
    const now = new Date().toISOString();
    const signInInput = {
      domain: "phantom.app",
      statement:
        "Clicking Sign or Approve only proves ownership of this wallet. This request does not send transactions.",
      uri: "https://phantom.app",
      version: "1",
      nonce: "oBbLoEldZs",
      chainId: "solana:mainnet",
      issuedAt: now,
      resources: ["https://example.com", "https://phantom.app/"],
    };

    return bs58.encode(Buffer.from(JSON.stringify(signInInput)));
  };

  const connect = async (overrides?: DeeplinkParamOverrides) => {
    const params = createAuthParams(onConnectRedirectLink, overrides);
    const url = buildUrl("connect", params);
    Linking.openURL(url);
  };

  const signIn = async (overrides?: DeeplinkParamOverrides) => {
    const payload = createSignInPayload();
    const params = createAuthParams(onSignInRedirectLink, overrides, payload);
    const url = buildUrl("signIn", params);
    Linking.openURL(url);
  };

  const disconnect = async (overrides?: DeeplinkParamOverrides) => {
    const payload = {
      session,
    };
    const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);

    const params = new URLSearchParams({
      dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
      nonce: bs58.encode(nonce),
      redirect_link: getRedirectLink(onDisconnectRedirectLink, overrides?.redirectLinkOverride),
      payload: bs58.encode(encryptedPayload),
    });

    const url = buildUrl("disconnect", params);
    Linking.openURL(url);
  };

  const signAndSendTransaction = async () => {
    const recentBlockhash = await getRecentBlockhash();
    const transaction = await createTransferTransaction(recentBlockhash);

    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
    });

    const payload = {
      session,
      transaction: bs58.encode(serializedTransaction),
    };
    const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);

    const params = new URLSearchParams({
      dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
      nonce: bs58.encode(nonce),
      redirect_link: onSignAndSendTransactionRedirectLink,
      payload: bs58.encode(encryptedPayload),
    });

    addLog("Sending transaction...");
    const url = buildUrl("signAndSendTransaction", params);
    Linking.openURL(url);
  };

  const signAllTransactions = async (overrides?: DeeplinkParamOverrides) => {
    const recentBlockhash = await getRecentBlockhash();
    const transactions = await Promise.all([
      createTransferTransaction(recentBlockhash),
      createTransferTransaction(recentBlockhash),
    ]);

    const serializedTransactions = transactions.map((t) =>
      bs58.encode(
        t.serialize({
          requireAllSignatures: false,
        }),
      ),
    );

    const payload = {
      session,
      transactions: serializedTransactions,
    };

    const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);

    const params = new URLSearchParams({
      dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
      nonce: bs58.encode(nonce),
      redirect_link: getRedirectLink(
        onSignAllTransactionsRedirectLink,
        overrides?.redirectLinkOverride,
      ),
      payload: bs58.encode(encryptedPayload),
    });

    addLog("Signing transactions...");
    const url = buildUrl("signAllTransactions", params);
    Linking.openURL(url);
  };

  const signTransaction = async (overrides?: DeeplinkParamOverrides) => {
    const recentBlockhash = await getRecentBlockhash();
    const transaction = await createTransferTransaction(recentBlockhash);

    const serializedTransaction = bs58.encode(
      transaction.serialize({
        requireAllSignatures: false,
      }),
    );

    const payload = {
      session,
      transaction: serializedTransaction,
    };

    const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);

    const params = new URLSearchParams({
      dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
      nonce: bs58.encode(nonce),
      redirect_link: getRedirectLink(
        onSignTransactionRedirectLink,
        overrides?.redirectLinkOverride,
      ),
      payload: bs58.encode(encryptedPayload),
    });

    addLog("Signing transaction...");
    const url = buildUrl("signTransaction", params);
    Linking.openURL(url);
  };

  const signMessage = async (overrides?: DeeplinkParamOverrides) => {
    const message = "To avoid digital dognappers, sign below to authenticate with CryptoCorgis.";

    const payload = {
      session,
      message: bs58.encode(Buffer.from(message)),
    };

    const [nonce, encryptedPayload] = encryptPayload(payload, sharedSecret);

    const params = new URLSearchParams({
      dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
      nonce: bs58.encode(nonce),
      redirect_link: getRedirectLink(onSignMessageRedirectLink, overrides?.redirectLinkOverride),
      payload: bs58.encode(encryptedPayload),
    });
    if (overrides?.appUrlOverride) {
      params.set("app_url", overrides.appUrlOverride);
    }

    addLog("Signing message...");
    const url = buildUrl("signMessage", params);
    Linking.openURL(url);
  };

  const connectOkOriginMismatch = async () =>
    connect({ appUrlOverride: OK_ORIGIN_MISMATCH_APP_URL });

  const signInOkOriginMismatch = async () => signIn({ appUrlOverride: OK_ORIGIN_MISMATCH_APP_URL });

  const signMessageOkOriginMismatch = async () =>
    signMessage({ appUrlOverride: OK_ORIGIN_MISMATCH_APP_URL });

  const connectOriginMismatch = async () =>
    connect({ appUrlOverride: ORIGIN_MISMATCH_WRONG_DEEPLINK_APP_URL });

  const signInOriginMismatch = async () =>
    signIn({ appUrlOverride: ORIGIN_MISMATCH_WRONG_DEEPLINK_APP_URL });

  const signMessageSpoofRedirect = async () =>
    signMessage({ redirectLinkOverride: SPOOF_REDIRECT_SIGN_MESSAGE });

  const signTransactionSpoofRedirect = async () =>
    signTransaction({ redirectLinkOverride: SPOOF_REDIRECT_SIGN_TRANSACTION });

  const signAllTransactionsSpoofRedirect = async () =>
    signAllTransactions({
      redirectLinkOverride: SPOOF_REDIRECT_SIGN_ALL_TRANSACTIONS,
    });

  const connectInvalidAppUrl = async () => connect({ appUrlOverride: INVALID_URL });

  const connectInvalidRedirectLink = async () => connect({ redirectLinkOverride: INVALID_URL });

  return (
    <View style={{ flex: 1, backgroundColor: "#333" }}>
      <StatusBar style="light" />
      <View style={{ flex: 6 }}>
        <ScrollView
          contentContainerStyle={{
            backgroundColor: "#111",
            padding: 20,
            paddingTop: 100,
            paddingBottom: 80,
            flexGrow: 1,
          }}
          ref={scrollViewRef}
          onContentSizeChange={() => {
            scrollViewRef.current.scrollToEnd({ animated: true });
          }}
          style={{ flex: 1 }}
        >
          {logs.map((log, i) => (
            <Text
              key={`t-${i}`}
              style={{
                fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace",
                color: "#fff",
                fontSize: 14,
              }}
            >
              {log}
            </Text>
          ))}
        </ScrollView>
        <View style={{ position: "absolute", left: 16, bottom: 16, zIndex: 1 }}>
          <Button title="Clear Logs" onPress={clearLog} />
        </View>
      </View>
      <View style={{ flex: 4 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20 }}>
          <Btn title="Connect" onPress={connect} />
          <Btn title="Disconnect" onPress={disconnect} />
          <Btn title="Sign And Send Transaction" onPress={signAndSendTransaction} />
          <Btn title="Sign All Transactions" onPress={signAllTransactions} />
          <Btn title="Sign Transaction" onPress={signTransaction} />
          <Btn title="Sign Message" onPress={signMessage} />
          <Btn title="Sign In" onPress={signIn} />
          <Btn title="Connect (OK ORIGIN MISMATCH)" onPress={connectOkOriginMismatch} />
          <Btn title="Sign In (OK ORIGIN MISMATCH)" onPress={signInOkOriginMismatch} />
          <Btn title="Sign Message (OK ORIGIN MISMATCH)" onPress={signMessageOkOriginMismatch} />
          <Btn title="Connect (ORIGIN MISMATCH)" onPress={connectOriginMismatch} />
          <Btn title="Sign In (ORIGIN MISMATCH)" onPress={signInOriginMismatch} />
          <Btn title="Sign Message (Spoof Redirect)" onPress={signMessageSpoofRedirect} />
          <Btn title="Sign Transaction (Spoof Redirect)" onPress={signTransactionSpoofRedirect} />
          <Btn
            title="Sign All Transactions (Spoof Redirect)"
            onPress={signAllTransactionsSpoofRedirect}
          />
          <Btn title="Connect (Invalid app_url)" onPress={connectInvalidAppUrl} />
          <Btn title="Connect (Invalid redirect_link)" onPress={connectInvalidRedirectLink} />
        </ScrollView>
      </View>
    </View>
  );
}

const Btn = ({ title, onPress }: { title: string; onPress: () => void | Promise<void> }) => {
  return (
    <View style={{ marginVertical: 10 }}>
      <Button title={title} onPress={onPress} />
    </View>
  );
};
