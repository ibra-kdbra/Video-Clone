import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './SearchBar.module.scss';

const SearchBar = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (event) => {
    event.preventDefault();

    if (searchTerm.trim()) {
      navigate(`/search/${encodeURIComponent(searchTerm.trim())}`);
      setSearchTerm('');
    }
  };

  return (
    <form className={styles.searchForm} onSubmit={handleSubmit}>
      <input
        type="text"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search videos, creators, topics"
        aria-label="Search videos"
      />
      
      {searchTerm && (
        <button 
          type="button" 
          className={styles.clearBtn}
          onClick={() => setSearchTerm('')}
          aria-label="Clear search"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      )}

      <button 
        type="submit" 
        className={styles.searchBtn}
        aria-label="Search"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </button>
    </form>
  );
};

export default SearchBar;
