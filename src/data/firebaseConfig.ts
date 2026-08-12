import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyBfit1NfE83ZH2WKdoFI5m53ij35HQMFCQ',
  authDomain: 'bagagensbarretao.firebaseapp.com',
  projectId: 'bagagensbarretao',
  storageBucket: 'bagagensbarretao.firebasestorage.app',
  messagingSenderId: '916863441758',
  appId: '1:916863441758:web:ac5505312635f25527cdcf',
}

export const firebaseApp = initializeApp(firebaseConfig)

export const firebaseAuth = getAuth(firebaseApp)

export const firestore = initializeFirestore(firebaseApp, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

export const AUTHORIZED_FIREBASE_UID = 'CCH6hEY9diXoS7h4ZXQkrjrITGF2'
