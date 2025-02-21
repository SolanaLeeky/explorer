<script lang="ts" setup>
import {
  useBlockchain,
  useFormatter,
  useStakingStore,
  useTxDialog,
} from '@/stores';
import DynamicComponent from '@/components/dynamic/DynamicComponent.vue';
import DonutChart from '@/components/charts/DonutChart.vue';
import { computed, ref } from '@vue/reactivity';
import { onMounted } from 'vue';
import { Icon } from '@iconify/vue';

import type {
  AuthAccount,
  Delegation,
  TxResponse,
  DelegatorRewards,
  UnbondingResponses,
  Coin
} from '@/types';
import Countdown from '@/components/Countdown.vue';
import { fromBase64 } from '@cosmjs/encoding';
import { formatIbcToken } from '@/libs';

const props = defineProps(['address', 'chain']);

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const dialog = useTxDialog();
const format = useFormatter();
const account = ref({} as AuthAccount);

// Instead of storing only the transactions, store the entire RPC response
const txResponse = ref<any>({});
// Although we’re not using txResponse for the Received table,
// we keep it for potential use elsewhere.
const txs = computed(() => txResponse.value.tx_responses || []);
const totalTxCount = computed(() => {
  return txResponse.value.total ? Number(txResponse.value.total) : txs.value.length;
});

// For Received txs and pagination:
const recentReceived = ref([] as TxResponse[]);
const recentReceivedTxCount = ref<number>(0);

// Pagination state for Received txs:
const currentPage = ref(1);
const itemsPerPage = ref(100); // adjust as needed
const totalPages = computed(() => {
  return Math.ceil(recentReceivedTxCount.value / itemsPerPage.value);
});

// --- Filter variables for the Recent Received table --- //
const filterFrom = ref('');
const filterTo = ref('');
const filterAmount = ref('');
const filterGas = ref('');
const filterTime = ref('');

// Computed property for filtering recentReceived txs on the UI:
const filteredRecentReceived = computed(() => {
  return recentReceived.value.filter((tx: any) => {
    // Get tx addresses using helper function:
    const { from, to } = getTxAddresses(tx);
    // Get the mapped amount string (e.g. "1.23 OM")
    const amountStr = mapAmount(tx);
    // Use tx.gas_wanted as a string and the formatted time.
    const gasStr = String(tx.gas_wanted);
    const timeStr = format.toLocaleDate(tx.timestamp);

    if (filterFrom.value && !from.toLowerCase().includes(filterFrom.value.toLowerCase())) {
      return false;
    }
    if (filterTo.value && !to.toLowerCase().includes(filterTo.value.toLowerCase())) {
      return false;
    }
    if (filterAmount.value && !amountStr.toLowerCase().includes(filterAmount.value.toLowerCase())) {
      return false;
    }
    if (filterGas.value && !gasStr.toLowerCase().includes(filterGas.value.toLowerCase())) {
      return false;
    }
    if (filterTime.value && !timeStr.toLowerCase().includes(filterTime.value.toLowerCase())) {
      return false;
    }
    return true;
  });
});

// Other state variables:
const delegations = ref([] as Delegation[]);
const rewards = ref({} as DelegatorRewards);
const balances = ref([] as Coin[]);
const formattedBalances = ref([] as Coin[]);
const unbonding = ref([] as UnbondingResponses[]);
const unbondingTotal = ref(0);

onMounted(() => {
  loadAccount(props.address);
  loadReceivedTxs(currentPage.value);
});

const totalAmountByCategory = computed(() => {
  let sumDel = 0;
  delegations.value?.forEach((x) => {
    sumDel += Number(x.balance.amount);
  });
  let sumRew = 0;
  rewards.value?.total?.forEach((x) => {
    sumRew += Number(x.amount);
  });
  let sumBal = 0;
  balances.value?.forEach((x) => {
    sumBal += Number(x.amount);
  });
  let sumUn = 0;
  unbonding.value?.forEach((x) => {
    x.entries?.forEach((y) => {
      sumUn += Number(y.balance);
    });
  });
  return [sumBal, sumDel, sumRew, sumUn];
});

const labels = ['Balance', 'Delegation', 'Reward', 'Unbonding'];

const totalAmount = computed(() => {
  return totalAmountByCategory.value.reduce((p, c) => c + p, 0);
});

const totalValue = computed(() => {
  let value = 0;
  delegations.value?.forEach((x) => {
    value += format.tokenValueNumber(x.balance);
  });
  rewards.value?.total?.forEach((x) => {
    value += format.tokenValueNumber(x);
  });
  balances.value?.forEach((x) => {
    value += format.tokenValueNumber(x);
  });
  unbonding.value?.forEach((x) => {
    x.entries?.forEach((y) => {
      value += format.tokenValueNumber({
        amount: y.balance,
        denom: stakingStore.params.bond_denom,
      });
    });
  });
  return format.formatNumber(value, '0,0.00');
});

async function loadAccount(address: string) {
  blockchain.rpc.getAuthAccount(address).then((x) => {
    account.value = x.account;
  });
  // Removed txs-by-sender filtering as requested.
  blockchain.rpc.getDistributionDelegatorRewards(address).then((x) => {
    rewards.value = x;
  });
  blockchain.rpc.getStakingDelegations(address).then((x) => {
    delegations.value = x.delegation_responses;
  });
  blockchain.rpc.getBankBalances(address).then(async (x) => {
    balances.value = x.balances;
    const tempFormattedBalances = [];
    for (let balanceItem of x.balances) {
      if (balanceItem.denom.toLowerCase().startsWith('ibc/')) {
        const ibcToken = await formatIbcToken(balanceItem, false);
        tempFormattedBalances.push({
          amount: ibcToken.amount,
          denom: ibcToken.denom,
        });
      } else {
        const formatted = format.formatToken(balanceItem);
        tempFormattedBalances.push({
          amount: formatted.split(' ')[0] === 'NaN'
            ? balanceItem.amount
            : formatted.split(' ')[0],
          denom: formatted.split(' ')[1],
        });
      }
    }
    formattedBalances.value = tempFormattedBalances;
  });
  blockchain.rpc.getStakingDelegatorUnbonding(address).then((x) => {
    unbonding.value = x.unbonding_responses;
    x.unbonding_responses?.forEach((y) => {
      y.entries.forEach((z) => {
        unbondingTotal.value += Number(z.balance);
      });
    });
  });
}

// Load received transactions for a given page (without client filtering)
function loadReceivedTxs(page: number) {
  const receivedQuery = `?&query=coin_received.receiver='${props.address}'&limit=${itemsPerPage.value}&page=${page}`;
  blockchain.rpc.getTxs(receivedQuery, {}).then((x) => {
    recentReceived.value = x.tx_responses;
    recentReceivedTxCount.value = x.total ? Number(x.total) : x.tx_responses.length;
  });
}

function updateEvent() {
  loadAccount(props.address);
  loadReceivedTxs(currentPage.value);
}

function mapAmount(tx: any): string {
  const msg = tx?.tx?.body?.messages?.[0];
  if (msg) {
    return `${msg?.amount?.[0]?.amount / 1000000 || ''} OM`;
  }
  return '';
}

function getTxAddresses(tx: any) {
  const msgs = tx?.tx?.body?.messages;
  let from = '';
  let to = '';
  if (msgs && Array.isArray(msgs)) {
    for (const msg of msgs) {
      if (msg.from_address && msg.to_address) {
        from = msg.from_address;
        to = msg.to_address;
        break;
      }
    }
  }
  return { from, to };
}

function shortenAddress(address: string): string {
  if (!address) return '';
  return address.slice(0, 5) + '.....' + address.slice(-5);
}
</script>

<template>
  <div v-if="account">
    <!-- Address Section -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <div class="flex items-center">
        <div class="inline-flex relative w-11 h-11 rounded-md">
          <div class="w-11 h-11 absolute rounded-md opacity-10 bg-primary"></div>
          <div class="w-full inline-flex items-center align-middle flex-none justify-center">
            <Icon icon="mdi-qrcode" class="text-primary" style="width: 27px; height: 27px" />
          </div>
        </div>
        <div class="flex flex-1 flex-col truncate pl-4">
          <h2 class="text-sm card-title">{{ $t('account.address') }}:</h2>
          <span class="text-xs truncate">{{ shortenAddress(address) }}</span>
        </div>
      </div>
    </div>

    <!-- Assets Section -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <div class="flex justify-between">
        <h2 class="card-title mb-4">{{ $t('account.assets') }}</h2>
        <div class="flex justify-end mb-4 pr-5">
          <label for="send" class="btn btn-primary btn-sm mr-2" @click="dialog.open('send', {}, updateEvent)">
            {{ $t('account.btn_send') }}
          </label>
          <label for="transfer" class="btn btn-primary btn-sm" @click="dialog.open('transfer', { chain_name: blockchain.current?.prettyName }, updateEvent)">
            {{ $t('account.btn_transfer') }}
          </label>
        </div>
      </div>
      <div class="grid md:!grid-cols-3">
        <div class="md:!col-span-1">
          <DonutChart :series="totalAmountByCategory" :labels="labels" />
        </div>
        <div class="mt-4 md:!col-span-2 md:!mt-0 md:!ml-4">
          <div>
            <!-- Balances -->
            <div class="flex items-center px-4 mb-2" v-for="(balanceItem, index) in formattedBalances" :key="index">
              <div class="w-9 h-9 rounded overflow-hidden flex items-center justify-center relative mr-4">
                <Icon icon="mdi-account-cash" class="text-info" size="20" />
                <div class="absolute top-0 bottom-0 left-0 right-0 bg-info opacity-20"></div>
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold">
                  {{ `${balanceItem.amount.toString().replace(',', '')} ${balanceItem.denom}` }}
                </div>
                <div class="text-xs">
                  {{ format.calculatePercent(balanceItem.amount, totalAmount) }}
                </div>
              </div>
              <div class="text-xs truncate relative py-1 px-3 rounded-full w-fit text-primary dark:invert mr-2">
                <span class="inset-x-0 inset-y-0 opacity-10 absolute bg-primary dark:invert text-sm"></span>
                ${{ format.tokenValue(balanceItem) }}
              </div>
            </div>
            <!-- Delegations -->
            <div class="flex items-center px-4 mb-2" v-for="(delegationItem, index) in delegations" :key="index">
              <div class="w-9 h-9 rounded overflow-hidden flex items-center justify-center relative mr-4">
                <Icon icon="mdi-user-clock" class="text-warning" size="20" />
                <div class="absolute top-0 bottom-0 left-0 right-0 bg-warning opacity-20"></div>
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold">
                  {{ format.formatToken(delegationItem?.balance) }}
                </div>
                <div class="text-xs">
                  {{ format.calculatePercent(delegationItem?.balance?.amount, totalAmount) }}
                </div>
              </div>
              <div class="text-xs truncate relative py-1 px-3 rounded-full w-fit text-primary dark:invert mr-2">
                <span class="inset-x-0 inset-y-0 opacity-10 absolute bg-primary dark:invert text-sm"></span>
                ${{ format.tokenValue(delegationItem?.balance) }}
              </div>
            </div>
            <!-- Rewards -->
            <div class="flex items-center px-4 mb-2" v-for="(rewardItem, index) in rewards.total" :key="index">
              <div class="w-9 h-9 rounded overflow-hidden flex items-center justify-center relative mr-4">
                <Icon icon="mdi-account-arrow-up" class="text-success" size="20" />
                <div class="absolute top-0 bottom-0 left-0 right-0 bg-success opacity-20"></div>
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold">
                  {{ format.formatToken(rewardItem) }}
                </div>
                <div class="text-xs">
                  {{ format.calculatePercent(rewardItem.amount, totalAmount) }}
                </div>
              </div>
              <div class="text-xs truncate relative py-1 px-3 rounded-full w-fit text-primary dark:invert mr-2">
                <span class="inset-x-0 inset-y-0 opacity-10 absolute bg-primary dark:invert text-sm"></span>
                ${{ format.tokenValue(rewardItem) }}
              </div>
            </div>
            <!-- Unbonding -->
            <div class="flex items-center px-4">
              <div class="w-9 h-9 rounded overflow-hidden flex items-center justify-center relative mr-4">
                <Icon icon="mdi-account-arrow-right" class="text-error" size="20" />
                <div class="absolute top-0 bottom-0 left-0 right-0 bg-error opacity-20"></div>
              </div>
              <div class="flex-1">
                <div class="text-sm font-semibold">
                  {{ format.formatToken({ amount: String(unbondingTotal), denom: stakingStore.params.bond_denom }) }}
                </div>
                <div class="text-xs">
                  {{ format.calculatePercent(unbondingTotal, totalAmount) }}
                </div>
              </div>
              <div class="text-xs truncate relative py-1 px-3 rounded-full w-fit text-primary dark:invert mr-2">
                <span class="inset-x-0 inset-y-0 opacity-10 absolute bg-primary dark:invert"></span>
                ${{ format.tokenValue({ amount: String(unbondingTotal), denom: stakingStore.params.bond_denom }) }}
              </div>
            </div>
          </div>
          <div class="mt-4 text-lg font-semibold mr-5 pl-5 border-t pt-4 text-right">
            {{ $t('account.total_value') }}: ${{ totalValue }}
          </div>
        </div>
      </div>
    </div>

    <!-- Delegations Section -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <div class="flex justify-between">
        <h2 class="card-title mb-4">{{ $t('account.delegations') }}</h2>
        <div class="flex justify-end mb-4">
          <label for="delegate" class="btn btn-primary btn-sm mr-2" @click="dialog.open('delegate', {}, updateEvent)">
            {{ $t('account.btn_delegate') }}
          </label>
          <label for="withdraw" class="btn btn-primary btn-sm" @click="dialog.open('withdraw', {}, updateEvent)">
            {{ $t('account.btn_withdraw') }}
          </label>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="table w-full text-sm table-zebra">
          <thead>
            <tr>
              <th class="py-3">{{ $t('account.validator') }}</th>
              <th class="py-3">{{ $t('account.delegation') }}</th>
              <th class="py-3">{{ $t('account.rewards') }}</th>
              <th class="py-3">{{ $t('account.action') }}</th>
            </tr>
          </thead>
          <tbody class="text-sm">
            <tr v-if="delegations.length === 0">
              <td colspan="10">
                <div class="text-center">{{ $t('account.no_delegations') }}</div>
              </td>
            </tr>
            <tr v-for="(v, index) in delegations" :key="index">
              <td class="text-caption text-primary py-3">
                <RouterLink :to="`/${chain}/staking/${v.delegation.validator_address}`">
                  {{ format.validatorFromBech32(v.delegation.validator_address) || v.delegation.validator_address }}
                </RouterLink>
              </td>
              <td class="py-3">
                {{ format.formatToken(v.balance, true, '0,0.[000000]') }}
              </td>
              <td class="py-3">
                {{ format.formatTokens(rewards?.rewards?.find((x) => x.validator_address === v.delegation.validator_address)?.reward) }}
              </td>
              <td class="py-3">
                <div v-if="v.balance" class="flex justify-end">
                  <label for="delegate" class="btn btn-primary btn-xs mr-2" @click="dialog.open('delegate', { validator_address: v.delegation.validator_address }, updateEvent)">
                    {{ $t('account.btn_delegate') }}
                  </label>
                  <label for="redelegate" class="btn btn-primary btn-xs mr-2" @click="dialog.open('redelegate', { validator_address: v.delegation.validator_address }, updateEvent)">
                    {{ $t('account.btn_redelegate') }}
                  </label>
                  <label for="unbond" class="btn btn-primary btn-xs" @click="dialog.open('unbond', { validator_address: v.delegation.validator_address }, updateEvent)">
                    {{ $t('account.btn_unbond') }}
                  </label>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Unbonding Delegations Section -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow" v-if="unbonding && unbonding.length > 0">
      <h2 class="card-title mb-4">{{ $t('account.unbonding_delegations') }}</h2>
      <div class="overflow-x-auto">
        <table class="table text-sm w-full">
          <thead>
            <tr>
              <th class="py-3">{{ $t('account.creation_height') }}</th>
              <th class="py-3">{{ $t('account.initial_balance') }}</th>
              <th class="py-3">{{ $t('account.balance') }}</th>
              <th class="py-3">{{ $t('account.completion_time') }}</th>
            </tr>
          </thead>
          <tbody class="text-sm" v-for="(v, index) in unbonding" :key="index">
            <tr>
              <td class="text-caption text-primary py-3 bg-slate-200" colspan="10">
                <RouterLink :to="`/${chain}/staking/${v.validator_address}`">
                  {{ v.validator_address }}
                </RouterLink>
              </td>
            </tr>
            <tr v-for="entry in v.entries" :key="entry.creation_height">
              <td class="py-3">{{ entry.creation_height }}</td>
              <td class="py-3">
                {{ format.formatToken({ amount: entry.initial_balance, denom: stakingStore.params.bond_denom }, true, '0,0.[00]') }}
              </td>
              <td class="py-3">
                {{ format.formatToken({ amount: entry.balance, denom: stakingStore.params.bond_denom }, true, '0,0.[00]') }}
              </td>
              <td class="py-3">
                <Countdown :time="new Date(entry.completion_time).getTime() - new Date().getTime()" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Received Transactions Section with Filters and Pagination -->
<!-- Received Transactions Section with Improved Filter UI -->
<div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
  <h2 class="card-title mb-4">{{ $t('account.received') }}</h2>
  <p>Total {{ recentReceivedTxCount }} transactions</p>

  <!-- Improved Filter Inputs -->
  <div class="mb-4 grid grid-cols-1 sm:grid-cols-5 gap-4">
    <div class="form-control">
      <label class="label">
        <span class="label-text text-xs">From</span>
      </label>
      <input
        v-model="filterFrom"  
        type="text" 
        placeholder="Filter From"
        class="input input-sm input-bordered"
      /> 
    </div>
    <div class="form-control">
      <label class="label"> 
        <span class="label-text text-xs">To</span>
      </label> 
      <input
        v-model="filterTo"
        type="text"
        placeholder="Filter To" 
        class="input input-sm input-bordered"
      />
    </div>
    <div class="form-control">
      <label class="label">
        <span class="label-text text-xs">Amount</span>
      </label>
      <input
        v-model="filterAmount"
        type="text"
        placeholder="Filter Amount"
        class="input input-sm input-bordered"
      />
    </div>
    <div class="form-control">
      <label class="label">
        <span class="label-text text-xs">Gas</span>
      </label>
      <input
        v-model="filterGas"
        type="text"
        placeholder="Filter Gas"
        class="input input-sm input-bordered"
      />
    </div>
    <div class="form-control">
      <label class="label">
        <span class="label-text text-xs">Time</span>
      </label>
      <input
        v-model="filterTime"
        type="text"
        placeholder="Filter Time"
        class="input input-sm input-bordered"
      />
    </div>
  </div>

  <div class="overflow-x-auto">
    <table class="table w-full text-sm">
      <thead>
        <tr>
          <th class="py-3">{{ $t('account.height') }}</th>
          <th class="py-3">{{ $t('account.hash') }}</th>
          <th class="py-3">From</th>
          <th class="py-3">To</th>
          <th class="py-3">{{ $t('account.amount') }}</th>
          <th class="py-3">Gas</th>
          <th class="py-3">{{ $t('account.time') }}</th>
        </tr>
      </thead>
      <tbody class="text-sm">
        <tr v-if="filteredRecentReceived.length === 0">
          <td colspan="10">
            <div class="text-center">{{ $t('account.no_transactions') }}</div>
          </td>
        </tr>
        <tr v-for="(v, index) in filteredRecentReceived" :key="index">
          <td class="text-sm py-3">
            <RouterLink :to="`/${chain}/block/${v.height}`" class="text-primary dark:invert">
              {{ v.height }}
            </RouterLink>
          </td>
          <td class="truncate py-3" style="max-width: 200px">
            <RouterLink :to="`/${chain}/tx/${v.txhash}`" class="text-primary dark:invert">
              {{ v.txhash }}
            </RouterLink>
          </td>
          <td class="py-3">
            <RouterLink
              :to="`/${chain}/account/${getTxAddresses(v).from}`"
              :class="{'text-primary dark:invert': getTxAddresses(v).from !== address}"
            >
              {{ shortenAddress(getTxAddresses(v).from) }}
            </RouterLink>
          </td>
          <td class="py-3">
            <RouterLink
              :to="`/${chain}/account/${getTxAddresses(v).to}`"
              :class="{'text-primary dark:invert': getTxAddresses(v).to !== address}"
            >
              {{ shortenAddress(getTxAddresses(v).to) }}
            </RouterLink>
          </td>
          <td class="flex items-center py-3">
            <div class="mr-2">{{ mapAmount(v) }}</div>
            <Icon v-if="v.code === 0" icon="mdi-check" class="text-success text-lg" />
            <Icon v-else icon="mdi-multiply" class="text-error text-lg" />
          </td>
          <td class="py-3">{{ v.gas_wanted }}</td>
          <td class="py-3">
            {{ format.toLocaleDate(v.timestamp) }}
            <span class="text-xs">({{ format.toDay(v.timestamp, 'from') }})</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Pagination Controls -->
  <div class="mt-4 flex justify-end items-center">
    <button 
      class="btn btn-sm mr-2" 
      :disabled="currentPage <= 1" 
      @click="currentPage--, loadReceivedTxs(currentPage)"
    >
      Previous
    </button>
    <span>Page {{ currentPage }} of {{ totalPages }}</span>
    <button 
      class="btn btn-sm ml-2" 
      :disabled="currentPage >= totalPages" 
      @click="currentPage++, loadReceivedTxs(currentPage)"
    >
      Next
    </button>
  </div>
</div>



    <!-- Account Details Section -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <h2 class="card-title mb-4">{{ $t('account.acc') }}</h2>
      <DynamicComponent :value="account" />
    </div>
  </div>
  <div v-else class="text-no text-sm">{{ $t('account.error') }}</div>
</template>
