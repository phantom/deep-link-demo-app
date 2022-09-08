import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import React, { useCallback, useRef, useState } from "react";
import { Button, Platform, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  Connection,
  SystemProgram,
  Transaction,
  clusterApiUrl
} from "@solana/web3.js";

import PhantomWallet from "./PhantomWallet";

const NETWORK = "devnet";


export default function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const connection = new Connection(clusterApiUrl(NETWORK));
  const phantomWallet = useRef(new PhantomWallet(NETWORK)).current;
  const addLog = useCallback((log: string) => {
      setLogs((logs) => [...logs, "> " + log]);
      console.log(log);
  }, []);
  const scrollViewRef = useRef<any>(null);

 
  const createTransferTransaction = async () => {
    return new Promise<Transaction>(async (resolve,reject)=>{
      const phantomWalletPublicKey = phantomWallet.getWalletPublicKey();
      if(!phantomWalletPublicKey) {
        reject('Not connected to a wallet');
        return;
      }

      let transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: phantomWalletPublicKey,
          toPubkey: phantomWalletPublicKey,
          lamports: 100,
        })
      );
      transaction.feePayer = phantomWalletPublicKey;
      addLog('Getting recent blockhash');
      const anyTransaction: any = transaction;
      anyTransaction.recentBlockhash = (await connection.getLatestBlockhash().catch(err=>reject(err))).blockhash;
      resolve(transaction);
    });
  };

  const connect = async () => {
    addLog('Connecting...');
    phantomWallet
    .connect()
    .then(()=> addLog('connected!'))
    .catch(error=>addLog(error));
  };

  const disconnect = async () => {
    addLog('Disconnecting...');
    phantomWallet
    .disconnect()
    .then(()=> addLog('disconnected!'))
    .catch(error=>addLog(error));    
  };

  const signAndSendTransaction = async () => {
    const transaction = await createTransferTransaction()
    .catch(err=>{
      addLog(err)
    });

    if(!transaction)
      return;

    addLog('Signing and sending transaction...');

    phantomWallet
    .signAndSendTransaction(transaction, false)
    .then((t)=> addLog(`signAndSendTransaction result: ${JSON.stringify(t)}`))
    .catch(error=>addLog(error));
  };

  const signAllTransactions = async () => {
    const transactions = await Promise.all([
      createTransferTransaction(),
      createTransferTransaction(),
    ])
    .catch(err=>addLog(err));

    if(!transactions)
      return;

    addLog('Signing multiple transactions...');

    phantomWallet
    .signAllTransactions(transactions, false)
    .then(ts=>{
      ts.map(t=>{
        addLog(`transaction: ${JSON.stringify(t)}`);
      })
    })
    .catch(error=>addLog(error));
  };

  const signTransaction = async () => {
    addLog('Signing transaction...');
    const transaction = await createTransferTransaction()
    .catch(addLog);
    
    if(!transaction)
      return;
    

    phantomWallet
    .signTransaction(transaction, false)
    .then(t=>addLog(`signed transaction: ${JSON.stringify(t)}`))
    .catch(error=>addLog(error));
  };

  const signMessage = async () => {
    const message = "To avoid digital dognappers, sign below to authenticate with CryptoCorgis.";
    addLog('Signing message...');

    phantomWallet
    .signMessage(message)
    .then((transaction)=> addLog(`signed message: ${JSON.stringify(transaction)}`))
    .catch(error=>addLog(error))    
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#333" }}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            backgroundColor: "#111",
            padding: 20,
            paddingTop: 100,
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
      </View>
      <View style={{ flex: 0, paddingTop: 20, paddingBottom: 40 }}>
        <Btn title="Connect" onPress={connect} />
        <Btn title="Disconnect" onPress={disconnect} />
        <Btn title="Sign And Send Transaction" onPress={signAndSendTransaction} />
        <Btn title="Sign All Transactions" onPress={signAllTransactions} />
        <Btn title="Sign Transaction" onPress={signTransaction} />
        <Btn title="Sign Message" onPress={signMessage} />
      </View>
    </View>
  );
}

const Btn = ({ title, onPress }: { title: string; onPress: () => Promise<void> }) => {
  return (
    <View style={{ marginVertical: 10 }}>
      <Button title={title} onPress={onPress} />
    </View>
  );
};
