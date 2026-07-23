// アシストカレンダー — Firebase接続設定
// 株式会社ホームメンテナンス / assist-calendar
//
// ここの値は公開されても問題ありません（ブラウザに配られる接続先の情報です）。
// 実際にデータを守っているのは firestore.rules と Authentication です。

export const firebaseConfig = {
  apiKey: "AIzaSyBsLacSQSBgHyDbVsaX8PxSEKxMMSyfKzg",
  authDomain: "assist-calendar-9b08e.firebaseapp.com",
  projectId: "assist-calendar-9b08e",
  storageBucket: "assist-calendar-9b08e.firebasestorage.app",
  messagingSenderId: "679659141281",
  appId: "1:679659141281:web:3acd2479d8973d556a18e0"
};

// ログインIDの後ろに付ける架空のドメイン。
// Firebaseの認証はメール形式が必要なため、ID 1001 → 1001@assist.local として扱います。
// メールは実在しなくて構いません。運用開始後は変更しないでください（ログインできなくなります）。
export const ID_DOMAIN = "assist.local";
