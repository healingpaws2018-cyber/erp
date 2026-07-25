import { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import PetBookModal from '../components/PetBookModal'

/**
 * PetBook.jsx — dedicated sidebar entry point for looking up any pet's health book
 * (the same PetBookModal Pets.jsx already opens via its row-level BookOpen icon), without
 * going through the pet registration/edit screen first. Read-only lookup: no add/edit/
 * delete here — that stays on the Pets page. Search-first list; click a row's Open Book
 * action to open that pet's book.
 */
export default function PetBook() {
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [owners, setOwners] = useState([])
  const [species, setSpecies] = useState([])
  const [breeds, setBreeds] = useState([])
  const [bookPetId, setBookPetId] = useState(null)

  const load = () => api.get('/pets', { params: { search } }).then(r => setData(r.data)).catch(() => {})
  useEffect(() => { load() }, [search])
  useEffect(() => {
    api.get('/owners').then(r => setOwners(r.data)).catch(() => {})
    api.get('/masters/species').then(r => setSpecies(r.data)).catch(() => {})
    api.get('/masters/breeds').then(r => setBreeds(r.data)).catch(() => {})
  }, [])

  const speciesMap = Object.fromEntries(species.map(s => [s.species_id, s.species_name]))
  const ownerMap   = Object.fromEntries(owners.map(o => [o.owner_id, o.name]))
  const breedMap   = Object.fromEntries(breeds.map(b => [b.breed_id, b.breed_name]))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-bold text-slate-800">Pet Book</h2>
          <p className="text-xs text-slate-400">Look up a pet's full health record — history, vaccinations, allergies, vitals &amp; labs</p>
        </div>
      </div>

      <Table
        columns={[
          { key: 'pet_code', label: 'Code', width: 100 },
          { key: 'name', label: 'Pet Name' },
          { key: 'species_id', label: 'Species', render: v => speciesMap[v] || '—' },
          { key: 'breed_id', label: 'Breed', render: v => breedMap[v] || '—' },
          { key: 'owner_id', label: 'Owner', render: v => ownerMap[v] || '—' },
        ]}
        data={data}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search pets by name..."
        actions={(row) => (
          <button
            onClick={() => setBookPetId(row.pet_id)}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Open Pet Book"
          >
            <BookOpen size={14} />
          </button>
        )}
        emptyText="No pets registered yet."
      />

      <PetBookModal isOpen={!!bookPetId} onClose={() => setBookPetId(null)} petId={bookPetId} />
    </div>
  )
}
