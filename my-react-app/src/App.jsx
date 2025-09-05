import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// --- Constants ---
const HOMES_TOTAL = 300;
const INITIAL_SEED = 12345;
const POPULATION_GROWTH_RATE = 0.04;
const INCOME_GROWTH_RATE = 0.025;
const AFFORDABILITY_MULTIPLIER = 3;
const BASE_APPRECIATION = 0.015;
const INITIAL_VACANCY_RATE = 0.05;
const RENTAL_TURNOVER_RATE = 0.10;
const RE_ENTRANT_RATE = 0.75;
const STR_CONVERSION_CHANCE = 0.05;
const STR_CAP_RATE = 0.03;
const MAX_RENT_INCREASE = 0.08;

// --- Helper Components ---
const Card = ({ label, value, subValue }) => (
  <div className="bg-white p-3 rounded-lg shadow text-center">
    <label className="block text-xs text-gray-500 mb-1 font-medium">{label}</label>
    <span className="text-xl font-bold text-gray-800">{value}</span>
    {subValue && <span className="block text-sm font-bold text-green-600">{subValue}</span>}
  </div>
);

// --- Main App Component ---
export default function App() {
  // --- Input State (configurable by user) ---
  const [turnoverRate, setTurnoverRate] = useState(4);
  const [newHomes, setNewHomes] = useState(3);
  const [yearsToRun, setYearsToRun] = useState(10); 
  const [initialSeekersCount, setInitialSeekersCount] = useState(36);
  // Add user-configurable starting owner counts
  const [initialHomeowners, setInitialHomeowners] = useState(170);
  const [initialIndividuals, setInitialIndividuals] = useState(100);
  const [initialCorporates, setInitialCorporates] = useState(30);
  
  // --- Simulation State (runs the model) ---
  const [year, setYear] = useState(1);
  const [housingStock, setHousingStock] = useState([]);
  const [seekerPool, setSeekerPool] = useState([]);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(500);

  // --- Display State (shown on screen) ---
  const [displayData, setDisplayData] = useState({});

  // --- Refs ---
  const marketResults = useRef({});
  const initialStats = useRef({});
  const nextSeekerId = useRef(0);
  const seededRandom = useRef(createSeededRandom(INITIAL_SEED));
  const cumulativeIncomeGrowth = useRef(1.0);

  // --- Utility Functions ---
  function createSeededRandom(seed) {
    let state = seed;
    return function() {
      state = (state * 1664525 + 1013904223) % 2**32;
      return state / 2**32;
    };
  }

  const getPercentChange = (initial, current) => {
    if (initial === 0 || !initial) return 'N/A';
    const change = ((current - initial) / initial) * 100;
  const color = change >= 0 ? 'text-green-600' : 'text-red-600';
    return <span className={color}>{`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</span>;
  };
  
  // --- Data Computation for Display ---
  const computeDisplayData = useCallback((stock, seekers, initial) => {
    const currentTotals = stock.reduce((acc, home) => {
      if (home.ownerType) acc[home.ownerType] = (acc[home.ownerType] || 0) + 1;
      return acc;
    }, { homeowner: 0, individual: 0, corporate: 0 });

    const prices = stock.map(h => h.price).sort((a,b)=>a-b);
    const medianPrice = prices.length > 0 ? prices[Math.floor(prices.length/2)] : 0;
    
    const rents = stock.filter(h => h.ownerType !== 'homeowner').map(h => h.rent).sort((a,b)=>a-b);
    const medianRent = rents.length > 0 ? rents[Math.floor(rents.length/2)] : 0;

    const vacantRentals = stock.filter(h => h.status === 'Vacant' && h.usage === 'LongTermRental').length;
    const totalRentals = stock.filter(h => h.ownerType !== 'homeowner' && h.usage === 'LongTermRental').length;
    const vacancyRate = totalRentals > 0 ? ((vacantRentals / totalRentals) * 100).toFixed(1) + '%' : 'N/A';
    
    const incomes = seekers.map(s => s.income).sort((a,b)=>a-b);
    const medianIncome = incomes.length > 0 ? incomes[Math.floor(incomes.length/2)] : 0;

    // Calculate total rent paid by all renters (occupied rental units)
    const totalRentPaid = stock.filter(h => h.ownerType !== 'homeowner' && h.status === 'Occupied').reduce((sum, h) => sum + h.rent, 0);
    // Calculate total income of the whole population
    const totalIncome = seekers.reduce((sum, s) => sum + s.income, 0);
    // Compute percent of income dedicated to rent
    const pctIncomeToRent = (totalIncome > 0) ? ((totalRentPaid / totalIncome) * 100).toFixed(1) : 'N/A';
    setDisplayData({
        seekerCount: seekers.length,
        vacantRentals,
        vacancyRate,
        medianIncome,
        medianPrice,
        medianRent,
        homeowners: currentTotals.homeowner,
        individualLandlords: currentTotals.individual,
        corporateLandlords: currentTotals.corporate,
        totalHomes: stock.length,
        pctOwnerOccupied: getPercentChange(initial.ownerOccupied, currentTotals.homeowner),
        pctIndividualLandlords: getPercentChange(initial.individualLandlords, currentTotals.individual),
        pctCorporateLandlords: getPercentChange(initial.corporateLandlords, currentTotals.corporate),
        pctMedianPrice: getPercentChange(initial.medianPrice, medianPrice),
        pctMedianRent: getPercentChange(initial.medianRent, medianRent),
        pctMedianIncome: getPercentChange(initial.medianIncome, medianIncome),
        pctIncomeToRent,
    });
  }, []);

  // --- Core Simulation Logic ---
  const setupSimulation = useCallback(() => {
    nextSeekerId.current = 0;
    seededRandom.current = createSeededRandom(INITIAL_SEED);
    cumulativeIncomeGrowth.current = 1.0;
    marketResults.current = {
        purchasesByHomeowner: 0, purchasesByCorporate: 0, purchasesByIndividual: 0,
        convertedToShortTerm: 0, totalAttrition: 0, displacements: 0,
    };
    
    const generateSortedData = (count, median, spread) => {
        const data = [median];
        for(let i = 1; i <= Math.floor((count - 1) / 2); i++) {
            data.push(median + seededRandom.current() * i * spread);
            data.unshift(median - seededRandom.current() * i * spread);
        }
        if (count % 2 === 0) {
           data.push(median + seededRandom.current() * (count/2) * spread);
        }
        return data.sort((a,b) => a-b);
    };

    const initialPrices = generateSortedData(HOMES_TOTAL, 350000, 1000);
    const initialIncomes = generateSortedData(initialSeekersCount, 100000, 500);
    
    // Ensure total is always 300
    const totalOwners = initialHomeowners + initialIndividuals + initialCorporates;
    const homeowners = initialHomeowners;
    const individuals = initialIndividuals;
    const corporates = initialCorporates;
    // If total is not 300, adjust corporates to fit
    let adjHomeowners = homeowners;
    let adjIndividuals = individuals;
    let adjCorporates = corporates;
    if (totalOwners !== HOMES_TOTAL) {
      const diff = HOMES_TOTAL - (homeowners + individuals);
      adjCorporates = diff;
    }
    // Build housing stock based on user input
    const newHousingStock = Array.from({ length: HOMES_TOTAL }, (_, i) => {
      let ownerType;
      if (i < adjCorporates) ownerType = 'corporate';
      else if (i < adjCorporates + adjIndividuals) ownerType = 'individual';
      else ownerType = 'homeowner';
      
      const price = initialPrices[i];
      let usage = (i < 3) ? 'ShortTermRental' : 'LongTermRental';
      let status;
      if (ownerType === 'homeowner') status = 'OwnerOccupied';
  else status = seededRandom.current() < Math.max(INITIAL_VACANCY_RATE, 0.015) ? 'Vacant' : 'Occupied';
      
      const rentSpread = (price / 350000);
      const rent = 2000 * rentSpread + (seededRandom.current() - 0.5) * 100;

      return { id: i, ownerType, usage, price, rent, status };
    });
    
    const newSeekerPool = Array.from({ length: initialSeekersCount }, (_, i) => ({
        id: nextSeekerId.current++,
        income: initialIncomes[i]
    }));
    
  // Calculate true medians from generated data
  const ownerOccupied = newHousingStock.filter(h => h.ownerType === 'homeowner').length;
  const individualLandlords = newHousingStock.filter(h => h.ownerType === 'individual').length;
  const corporateLandlords = newHousingStock.filter(h => h.ownerType === 'corporate').length;
  const prices = newHousingStock.map(h => h.price).sort((a,b)=>a-b);
  const medianPrice = prices.length > 0 ? prices[Math.floor(prices.length/2)] : 0;
  const rents = newHousingStock.filter(h => h.ownerType !== 'homeowner').map(h => h.rent).sort((a,b)=>a-b);
  const medianRent = rents.length > 0 ? rents[Math.floor(rents.length/2)] : 0;
  const incomes = newSeekerPool.map(s => s.income).sort((a,b)=>a-b);
  const medianIncome = incomes.length > 0 ? incomes[Math.floor(incomes.length/2)] : 0;
  initialStats.current = {
    ownerOccupied,
    individualLandlords,
    corporateLandlords,
    medianPrice,
    medianRent,
    medianIncome,
  };

    setHousingStock(newHousingStock);
    setSeekerPool(newSeekerPool);
    computeDisplayData(newHousingStock, newSeekerPool, initialStats.current);
  }, [initialSeekersCount, computeDisplayData]);

  const advanceYear = useCallback(() => {
    const newStock = structuredClone(housingStock);
    let newSeekerPool = structuredClone(seekerPool);

    cumulativeIncomeGrowth.current *= (1 + INCOME_GROWTH_RATE);
    newSeekerPool.forEach(seeker => {
        seeker.income *= (1 + INCOME_GROWTH_RATE);
    });
    
    const housedPopulation = newStock.filter(h => h.status !== 'Vacant').length;
    const newEntrantCount = Math.floor((housedPopulation + newSeekerPool.length) * POPULATION_GROWTH_RATE);
    for (let i = 0; i < newEntrantCount; i++) {
      const baseIncome = 100000 - 50000 + seededRandom.current() * 100000;
      newSeekerPool.push({ id: nextSeekerId.current++, income: baseIncome * cumulativeIncomeGrowth.current });
    }

    const homesForSaleIndices = new Set();
    const homesForSaleCount = Math.floor(newStock.length * (turnoverRate / 100));
    while (homesForSaleIndices.size < homesForSaleCount && homesForSaleIndices.size < newStock.length) {
      homesForSaleIndices.add(Math.floor(seededRandom.current() * newStock.length));
    }
    const homesForSale = Array.from(homesForSaleIndices).map(index => newStock[index]);

    newStock.forEach(home => {
        if (home.ownerType !== 'homeowner' && home.status === 'Occupied' && seededRandom.current() < RENTAL_TURNOVER_RATE) {
            home.status = 'Vacant';
            if (seededRandom.current() < RE_ENTRANT_RATE) {
                const baseIncome = 100000 - 50000 + seededRandom.current() * 100000;
                newSeekerPool.push({ id: nextSeekerId.current++, income: baseIncome * cumulativeIncomeGrowth.current });
            }
        }
    });

    const sellProperty = (home) => {
      const affordableSeekers = newSeekerPool.filter(s => s.income * AFFORDABILITY_MULTIPLIER >= home.price);
      const seekerInTheRunning = affordableSeekers.length > 0;
      const roll = seededRandom.current();
      let winnerType;
  
      if (seekerInTheRunning) {
  if (roll < 0.20) winnerType = 'corporate';
  else if (roll < 0.35) winnerType = 'individual';
  else winnerType = 'seeker';
      } else {
        if (roll < 0.71) winnerType = 'corporate';
        else winnerType = 'individual';
      }
  
      const corporateOwnershipRatio = newStock.filter(h => h.ownerType === 'corporate').length / newStock.length;
      if (winnerType === 'corporate' && corporateOwnershipRatio >= 0.30) {
        winnerType = seekerInTheRunning ? (seededRandom.current() < (25/40) ? 'individual' : 'seeker') : 'individual';
      }
  
      const processWinner = (type) => {
        const wasOccupiedRental = home.ownerType !== 'homeowner' && home.status === 'Occupied';
        if (type === 'seeker') {
            home.ownerType = 'homeowner';
            home.status = 'OwnerOccupied';
            marketResults.current.purchasesByHomeowner++;
            affordableSeekers.sort((a,b) => b.income - a.income);
            const buyerId = affordableSeekers[0].id;
            newSeekerPool = newSeekerPool.filter(s => s.id !== buyerId);
            if (wasOccupiedRental) {
                const baseIncome = 100000 - 50000 + seededRandom.current() * 100000;
                newSeekerPool.push({ id: nextSeekerId.current++, income: baseIncome * cumulativeIncomeGrowth.current });
                marketResults.current.displacements++;
            }
        } else {
            if(home.ownerType !== type) marketResults.current[type === 'corporate' ? 'purchasesByCorporate' : 'purchasesByIndividual']++;
            home.ownerType = type;
            const strRatio = newStock.filter(h => h.usage === 'ShortTermRental').length / newStock.length;
            if (strRatio < STR_CAP_RATE && seededRandom.current() < STR_CONVERSION_CHANCE) {
                home.usage = 'ShortTermRental';
                marketResults.current.convertedToShortTerm++;
            } else {
                home.usage = 'LongTermRental';
            }
            home.status = wasOccupiedRental ? 'Occupied' : 'Vacant';
        }
      };
      processWinner(winnerType);
    };
    
    homesForSale.forEach(home => sellProperty(home));
    for (let i = 0; i < newHomes; i++) {
        const newPrice = 400000 + seededRandom.current() * 250000;
        const newHome = { id: newStock.length + 1, price: newPrice, rent: newPrice * 0.005, status: 'Vacant' };
        newStock.push(newHome);
        sellProperty(newHome);
    }

  // Enforce minimum vacancy rate of 1.5%
  const totalRentals = newStock.filter(h => h.ownerType !== 'homeowner' && h.usage === 'LongTermRental').length;
  const minVacant = Math.ceil(totalRentals * 0.015);
  let vacantUnits = newStock.filter(home => home.status === 'Vacant' && home.usage === 'LongTermRental');
  newSeekerPool.sort(() => seededRandom.current() - 0.5);
  vacantUnits.forEach((unit, idx) => {
    if (newSeekerPool.length > 0 && idx >= minVacant) {
      unit.status = 'Occupied';
      newSeekerPool.shift();
    }
  });

    const unhousedSeekers = newSeekerPool.length;
    const appreciationRate = BASE_APPRECIATION + (unhousedSeekers * 0.0005) + ((3-newHomes) * 0.01);
    let rentIncreaseRate = appreciationRate + (unhousedSeekers * 0.001);
    if (rentIncreaseRate > MAX_RENT_INCREASE) rentIncreaseRate = MAX_RENT_INCREASE;
    
    newStock.forEach(home => {
      home.price *= (1 + appreciationRate);
      if (home.ownerType !== 'homeowner') home.rent *= (1 + rentIncreaseRate);
    });

    setHousingStock(newStock);
    setSeekerPool(newSeekerPool);
    setYear(prevYear => prevYear + 1);
    computeDisplayData(newStock, newSeekerPool, initialStats.current);

  }, [housingStock, seekerPool, turnoverRate, newHomes, computeDisplayData]);

  // --- Effects ---
  useEffect(() => {
    setupSimulation();
  }, [setupSimulation]);

  useEffect(() => {
    if (!simulationRunning) return;
    const intervalId = setInterval(() => {
      if (year >= yearsToRun) { setSimulationRunning(false); return; }
      advanceYear();
    }, simulationSpeed);
    return () => clearInterval(intervalId);
  }, [simulationRunning, yearsToRun, advanceYear, year, simulationSpeed]);

  // --- Event Handlers ---
  const handleRunSimulation = () => setSimulationRunning(prev => !prev);
  const handleReset = () => {
    setSimulationRunning(false);
    setYear(0);
    setTurnoverRate(4);
    setNewHomes(3);
    setYearsToRun(10);
    setInitialSeekersCount(36);
    setSimulationSpeed(500);
    setupSimulation();
  };

  // --- Render ---
  return (
    <div className="bg-slate-50 font-sans p-4 sm:p-6 lg:p-8 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <header className="text-center pb-4 mb-6 border-b">
          <h1 className="text-4xl font-bold text-gray-800">Housing Market Simulation</h1>
          <p className="text-gray-600 mt-2">An interactive model to explore housing market dynamics.</p>
        </header>
        
        <div className="space-y-4 mb-8">
            <div className="flex flex-col items-center gap-4">
                <div className="flex flex-wrap gap-4 items-center justify-center">
                    <div className="bg-white p-3 rounded-lg shadow flex gap-4 items-center">
                        {/* Sale Turnover, New Homes, Seekers, Homeowners, Individuals, Corporates */}
                        <div>
                            <label className="text-xs font-medium text-gray-500 block">Sale Turnover (%)</label>
                            <input type="number" value={turnoverRate} onChange={e => setTurnoverRate(Number(e.target.value))} className="w-24 p-1 border rounded-md text-center"/>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block">New Homes / Year</label>
                            <input type="number" value={newHomes} onChange={e => setNewHomes(Number(e.target.value))} className="w-24 p-1 border rounded-md text-center"/>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block">Initial Seekers</label>
                            <input type="number" value={initialSeekersCount} onChange={e => setInitialSeekersCount(Number(e.target.value))} className="w-24 p-1 border rounded-md text-center"/>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block">Homeowners</label>
                            <input type="number" value={initialHomeowners} min={0} max={HOMES_TOTAL} onChange={e => setInitialHomeowners(Number(e.target.value))} className="w-20 p-1 border rounded-md text-center" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block">Individual Landlords</label>
                            <input type="number" value={initialIndividuals} min={0} max={HOMES_TOTAL} onChange={e => setInitialIndividuals(Number(e.target.value))} className="w-20 p-1 border rounded-md text-center" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block">Corporate Owners</label>
                            <input type="number" value={initialCorporates} min={0} max={HOMES_TOTAL} onChange={e => setInitialCorporates(Number(e.target.value))} className="w-20 p-1 border rounded-md text-center" />
                        </div>
                    </div>
                </div>
                <div className="flex gap-3 items-center justify-center mt-2">
                    <button onClick={handleRunSimulation} className={`font-bold px-4 py-2 rounded-md text-white ${simulationRunning ? 'bg-orange-500 hover:bg-orange-600' : 'bg-green-600 hover:bg-green-700'}`}>{simulationRunning ? 'Pause' : 'Run'}</button>
                    <input type="number" value={yearsToRun} onChange={e => setYearsToRun(Number(e.target.value))} className="w-16 p-1 border rounded-md text-center" />
                </div>
            </div>
            <div className="flex items-center gap-4 justify-center mt-2">
                <button onClick={handleReset} disabled={simulationRunning} className="border border-gray-400 px-3 py-2 rounded-md bg-white hover:bg-gray-100">Reset</button>
                <button onClick={advanceYear} disabled={simulationRunning} className="border border-gray-400 px-3 py-2 rounded-md bg-white hover:bg-gray-100">Advance Year</button>
                <div className="text-2xl font-bold">Year: <span>{year}</span></div>
            </div>
        </div>
        
        <main>
          <h3 className="text-2xl font-bold text-center mb-4">Current Market Stats</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4 mb-8">
            <Card label="Population Seeking Housing" value={displayData.seekerCount} subValue="Seeking Homes"/>
            <Card label="Vacant Rental Units" value={displayData.vacantRentals} subValue={`${displayData.vacancyRate} Rate`} />
            <Card label="Median Seeker Income" value={`$${Math.round((displayData.medianIncome || 0)/1000)}k`} subValue={displayData.pctMedianIncome} />
            <Card label="Median Home Price" value={`$${Math.round((displayData.medianPrice || 0) / 1000)}k`} subValue={displayData.pctMedianPrice} />
            <Card label="Median Rent" value={`$${Math.round(displayData.medianRent || 0).toLocaleString()}`} subValue={displayData.pctMedianRent} />
            <Card label="Homeowners" value={displayData.homeowners} subValue={displayData.pctOwnerOccupied} />
            <Card label="Individual Landlords" value={displayData.individualLandlords} subValue={displayData.pctIndividualLandlords} />
            <Card label="Corporate Landlords" value={displayData.corporateLandlords} subValue={displayData.pctCorporateLandlords} />
            <Card label="% Income to Rent" value={`${displayData.pctIncomeToRent}%`} subValue="of Population Income" />
          </div>

          <div id="housing-visual-grid" className="grid grid-cols-30 gap-0.5 p-1 bg-gray-300 rounded-lg mx-auto">
            {[...housingStock]
              .sort((a, b) => {
                // Group ShortTermRental (purple) first, then by status
                const usageOrder = {
                  'ShortTermRental': 0,
                  'LongTermRental': 1
                };
                const statusOrder = {
                  'OwnerOccupied': 0,
                  'Occupied': 1,
                  'Vacant': 2
                };
                const usageDiff = usageOrder[a.usage] - usageOrder[b.usage];
                if (usageDiff !== 0) return usageDiff;
                return statusOrder[a.status] - statusOrder[b.status];
              })
              .map(home => {
                let fill = '#9ca3af'; // gray-400
                if (home.usage === 'ShortTermRental') fill = '#a21caf'; // purple-500
                else if (home.status === 'OwnerOccupied') fill = '#22c55e'; // green-500
                else if (home.status === 'Occupied') fill = '#1e40af'; // blue-800
                else if (home.status === 'Vacant') fill = '#60a5fa'; // blue-400
                return (
                  <svg key={home.id} width="36" height="36" viewBox="0 0 24 24" className="mx-auto" style={{height: '2.25rem', width: '2.25rem'}}>
                    <rect x="6" y="10" width="12" height="8" rx="2" fill={fill} />
                    <polygon points="12,4 4,12 20,12" fill={fill} />
                  </svg>
                );
              })}
          </div>

           <div className="flex justify-center flex-wrap gap-6 mt-4 text-sm p-4 bg-white rounded-lg shadow">
              <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-green-500"></div>Owner Occupied</div>
              <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-blue-400"></div>Rental Vacant</div>
              <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-blue-800"></div>Rental Occupied</div>
              <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-purple-500"></div>Short-Term Rental</div>
           </div>

           <hr className="my-10" />
           
           <h3 className="text-2xl font-bold text-center mb-4">Cumulative Market Activity</h3>
           <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4 mb-4">
               <Card label="Homeowner Purchases" value={marketResults.current.purchasesByHomeowner} />
               <Card label="Corporate Purchases" value={marketResults.current.purchasesByCorporate} />
               <Card label="Individual Purchases" value={marketResults.current.purchasesByIndividual} />
               <Card label="Converted to STR" value={marketResults.current.convertedToShortTerm} />
               <Card label="Displacements" value={marketResults.current.displacements} />
               <Card label="Total Attrition" value={marketResults.current.totalAttrition} />
           </div>
        </main>
      </div>
    </div>
  );
}