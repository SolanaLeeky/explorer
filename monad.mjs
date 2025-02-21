/********************************************************************
 * 1. Load dependencies 
 ********************************************************************/
import fetch from 'node-fetch';
// import { ethers } from 'ethers';

/********************************************************************
 * 2. Define constants 
 ********************************************************************/
const API_KEY_2CAPTCHA = 'b5a7381471062720a0d36dace0d09697'; 
const WEBSITE_URL = 'https://testnet.monad.xyz/';
const SITE_KEY = '6Le4e90qAAAAAFmgNU7C2dwxuRHj9lO7x54cKaJt';
const CREATE_TASK_URL = 'https://api.2captcha.com/createTask';
const GET_TASK_RESULT_URL = 'https://api.2captcha.com/getTaskResult';
const MIN_SCORE = 0.9;
const TARGET_ENDPOINT = 'https://testnet.monad.xyz/api/claim';
const ADDRESS = "0x43cf056c8f9e4ca5ece19831635fc058d57e668e";
const VISITOR_ID = "d035256e1b3d22ec26985d9ecb82a393";

// Define the Monad Testnet RPC endpoint and chain details
// const RPC_ENDPOINT = 'https://testnet-rpc.monad.xyz';
// const CHAIN_ID = 10143;
// const NETWORK_NAME = 'Monad Testnet';

// // Initialize a provider using the given RPC endpoint
// const provider = new ethers.providers.JsonRpcProvider(
//   {
//     url: RPC_ENDPOINT,
//     // Optionally, chainId and name can help ethers.js recognize the network
//     chainId: CHAIN_ID,
//     name: NETWORK_NAME,
//   }
// );

// // Function to get balance for a given address
// async function getBalance(address) {
//   try {
//     // Fetch the balance (returned in Wei)
//     const balanceWei = await provider.getBalance(address);
//     // Convert balance from Wei to MON (assuming MON uses 18 decimals, similar to Ether)
//     const balanceMON = ethers.utils.formatEther(balanceWei);
//     console.log(`Balance of ${address}: ${balanceMON} MON`);


//   } catch (error) {
//     console.error('Error fetching balance:', error);
//   }
// }
// Common request headers for the final submission
const REQUEST_HEADERS = {
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9,my;q=0.8",
  "Content-Type": "application/json",
  "Priority": "u=1, i",
  "Sec-CH-UA": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Google Chrome\";v=\"132\"",
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": "\"Windows\"",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Referer": "https://testnet.monad.xyz/",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

/********************************************************************
 * 3. Create reCAPTCHA v3 Task Function
 ********************************************************************/
async function createRecaptchaV3Task() {
  const payload = {
    clientKey: API_KEY_2CAPTCHA,
    task: {
      type: 'RecaptchaV3TaskProxyless',
      websiteURL: WEBSITE_URL,
      websiteKey: SITE_KEY,
      minScore: MIN_SCORE,
      // pageAction can be included if required by the target site.
    //   isEnterprise: false,           
    //   apiDomain: 'google.com'
    }
  };

  const response = await fetch(CREATE_TASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (data.errorId !== 0) {
    throw new Error(`2captcha createTask error: ${data.errorDescription}`);
  }
  
  return data.taskId;
}

/********************************************************************
 * 4. Poll for Task Result Function
 ********************************************************************/
async function getRecaptchaV3Result(taskId) {
  while (true) {
    const payload = {
      clientKey: API_KEY_2CAPTCHA,
      taskId: taskId,
    };

    const response = await fetch(GET_TASK_RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (data.errorId !== 0) {
      throw new Error(`2captcha getTaskResult error: ${data.errorDescription}`);
    }

    if (data.status === 'ready') {
      // Return the solved token.
      return data.solution.gRecaptchaResponse;
    }

    console.log('Captcha not ready yet. Retrying in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

/********************************************************************
 * 5. Submit Form with Solved Token Function
 ********************************************************************/
async function submitFormWithSolvedToken(solvedToken) {
  const body = {
    address: ADDRESS,
    recaptchaToken: solvedToken,
    visitorId: VISITOR_ID
  };

  const response = await fetch(TARGET_ENDPOINT, {
    method: 'POST',
    headers: REQUEST_HEADERS,
    body: JSON.stringify(body),
  });

  // Check for timeout or retry conditions
  if (response.status === 504) {
    console.error('Received 504 Gateway Timeout. Will retry...');
    return null;
  }

  const result = await response.json();
  return result;
}

/********************************************************************
 * 6. Main Flow: Solve reCAPTCHA & Submit Request
 ********************************************************************/
async function run() {
  let finalResult = null;
  while (finalResult === null) {
    try {
    //   getBalance(ADDRESS);
      console.log('Creating reCAPTCHA v3 task...');
      const taskId = await createRecaptchaV3Task();
      console.log('Task created. Task ID:', taskId);
  
      console.log('Polling for captcha solution...');
      const solvedToken = await getRecaptchaV3Result(taskId);
      console.log('Captcha solved! Token received.');
  
      console.log('Submitting form with solved token...');
      finalResult = await submitFormWithSolvedToken(solvedToken);
  
      if (finalResult) {
        console.log('Final request result:', finalResult);
      } else {
        console.log('Submission returned no result. Retrying...');
      }
    } catch (err) {
      console.error('Error:', err.message);
      // Optionally wait before retrying on error.
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

run();




// Replace with the address you want to check
