import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import { Buffer } from "buffer";
global.Buffer = global.Buffer || Buffer;
import React, { useRef } from "react";
import { Button, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { usePhantom } from "./src/hooks/usePhantom";

export default function App() {
  const scrollViewRef = useRef<any>(null);
  const {
    logs,
    connect,
    disconnect,
    signAndSendTransaction,
    signAllTransactions,
    signTransaction,
    signMessage,
  } = usePhantom();

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
